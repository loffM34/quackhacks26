// ──────────────────────────────────────────────────────────
// Background Service Worker — AI Content Shield
// ──────────────────────────────────────────────────────────
// MV3 service worker. Receives block/container extractions from content scripts,
// calls the backend gateway for AI detection, caches results in
// chrome.storage.session, and broadcasts results back to content scripts
// and sidepanel/popup UI.

import type {
  ExtensionMessage,
  PageAnalysis,
  PageExtraction,
  BackendDetectionResponse,
  ContentScore,
  ShieldSettings,
  FlagTier,
  TextChunkInput,
  ImageInput,
} from "./types";

// ── In-memory session cache (survives across tabs, cleared on SW restart) ──
const resultCache = new Map<string, PageAnalysis>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Default backend URL (overridden by settings) ──
let backendUrl = "http://localhost:3001";

chrome.storage.local.get("settings").then((result) => {
  if (result.settings?.backendUrl) {
    backendUrl = result.settings.backendUrl;
  }
});

// ──────────────────────────────────────────────────────────
// Message listener
// ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    switch (message.type) {
      case "EXTRACT_CONTENT":
        handleExtraction(message.payload as PageExtraction, sender.tab?.id)
          .then(sendResponse)
          .catch((err) => {
            console.error("[Flare BG] Analysis error:", err);
            sendResponse(null);
          });
        return true;

      case "ANALYZE_REQUEST":
        handleManualAnalysis(sender.tab?.id)
          .then(sendResponse)
          .catch((err) => {
            console.error("[Flare BG] Manual analysis error:", err);
            sendResponse(null);
          });
        return true;

      case "GET_RESULT":
        handleGetResult(sender.tab?.id).then(sendResponse);
        return true;

      case "UPDATE_SETTINGS":
        handleUpdateSettings(message.payload as Partial<ShieldSettings>)
          .then(() => sendResponse({ ok: true }))
          .catch((err) => {
            console.error("[Flare BG] Settings update failed:", err);
            sendResponse({ ok: false, error: "Failed to update settings" });
          });
        return true;

      case "OPEN_SIDE_PANEL":
        if (sender.tab?.id) {
          chrome.sidePanel.open({ tabId: sender.tab.id }).catch(console.error);
        }
        sendResponse({ ok: true });
        return true;

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
        return true;
    }
  },
);

// ──────────────────────────────────────────────────────────
// Analysis flow
// ──────────────────────────────────────────────────────────

async function handleExtraction(
  extraction: PageExtraction,
  tabId?: number,
): Promise<PageAnalysis | null> {
  const cacheKey = generateCacheKey(extraction.url, extraction.containers);

  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.analyzedAt < CACHE_TTL_MS) {
    const cachedResult = { ...cached, cached: true };

    if (tabId) {
      await persistAnalysisForTab(tabId, cachedResult);
      await broadcastAnalysis(tabId, cachedResult);
      updateActionBadge(tabId, cachedResult.overallScore);
    }

    return cachedResult;
  }

  const textItems = await analyzeContainers(extraction.containers);
  const imageItems = await analyzeImages(extraction.images);

  const allItems = [...textItems, ...imageItems];

  const textScore = Math.round(average(textItems.map((item) => item.score)));
  const imageScore = Math.round(average(imageItems.map((item) => item.score)));

  let overallScore = 0;
  if (textItems.length > 0 && imageItems.length > 0) {
    overallScore = Math.round(textScore * 0.6 + imageScore * 0.4);
  } else if (textItems.length > 0) {
    overallScore = textScore;
  } else if (imageItems.length > 0) {
    overallScore = imageScore;
  }

  const flaggedCount = allItems.filter(
    (item) => item.tier === "medium" || item.tier === "high",
  ).length;
  const aiDensity =
    allItems.length > 0
      ? Math.round((flaggedCount / allItems.length) * 100)
      : 0;

  const analysis: PageAnalysis = {
    overallScore,
    textScore,
    imageScore,
    aiDensity,
    items: allItems,
    url: extraction.url,
    analyzedAt: Date.now(),
    cached: false,
  };

  resultCache.set(cacheKey, analysis);

  if (tabId) {
    await persistAnalysisForTab(tabId, analysis);
    await broadcastAnalysis(tabId, analysis);
    updateActionBadge(tabId, analysis.overallScore);
  }

  return analysis;
}

async function handleManualAnalysis(
  tabId?: number,
): Promise<PageAnalysis | null> {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tab?.id;
  }

  if (!tabId) return null;

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_CONTENT_TRIGGER" }, () => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Flare BG] Manual analysis trigger failed:",
          chrome.runtime.lastError.message,
        );
        resolve(null);
        return;
      }

      const pollKey = `tab_${tabId}`;
      let attempts = 0;
      const maxAttempts = 20;

      const poll = setInterval(async () => {
        attempts += 1;

        try {
          const stored = await chrome.storage.session.get(pollKey);
          const result = stored[pollKey] as PageAnalysis | undefined;

          if (result && Date.now() - result.analyzedAt < 15000) {
            clearInterval(poll);
            resolve(result);
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            resolve(null);
          }
        } catch {
          clearInterval(poll);
          resolve(null);
        }
      }, 500);
    });
  });
}

async function handleGetResult(tabId?: number): Promise<PageAnalysis | null> {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tab?.id;
  }

  if (!tabId) return null;

  const result = await chrome.storage.session.get(`tab_${tabId}`);
  return result[`tab_${tabId}`] || null;
}

async function handleUpdateSettings(
  partial: Partial<ShieldSettings>,
): Promise<void> {
  const current = await chrome.storage.local.get("settings");

  const DEFAULT_SETTINGS: ShieldSettings = {
    threshold: 70,
    autoBlur: false,
    elderMode: false,
    privacyConsent: true,
    showSearchDots: true,
    backendUrl: "http://localhost:3001",
  };

  const updated: ShieldSettings = {
    ...DEFAULT_SETTINGS,
    ...(current.settings || {}),
    ...partial,
  };

  await chrome.storage.local.set({ settings: updated });

  if (updated.backendUrl) {
    backendUrl = updated.backendUrl;
  }
}

// ──────────────────────────────────────────────────────────
// Backend calls
// ──────────────────────────────────────────────────────────

async function analyzeContainers(
  containers: Array<{ id: string; text: string }>,
): Promise<ContentScore[]> {
  if (containers.length === 0) return [];

  const chunks: TextChunkInput[] = containers
    .slice(0, 30)
    .map((container) => ({
      id: container.id,
      text: container.text.slice(0, 2500),
      kind: "block",
    }))
    .filter((chunk) => wordCount(chunk.text) >= 60);

  if (chunks.length === 0) return [];

  try {
    const response = await fetch(`${backendUrl}/detect/text/spans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks }),
    });

    if (!response.ok) {
      console.warn(`[Flare BG] /detect/text/spans returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as BackendDetectionResponse;
    const results = data.details?.results ?? [];

    return results.map((result) => {
      const original = chunks.find((chunk) => chunk.id === result.id);

      return {
        id: result.id,
        type: "text",
        score: normalizeBackendScore(result.score),
        tier:
          result.tier || tierFromPercent(normalizeBackendScore(result.score)),
        preview: (result.text || original?.text || "").slice(0, 220),
        provider: data.provider || "python-model",
        explanation: result.explanation ?? null,
      };
    });
  } catch (err) {
    console.warn("[Flare BG] Failed to analyze text blocks:", err);
    return [];
  }
}

async function analyzeImages(images: string[]): Promise<ContentScore[]> {
  if (!images || images.length === 0) return [];

  // Resolve url: prefixed entries by fetching them (CORS fallback from content script)
  const resolvedImages: string[] = [];
  for (const img of images.slice(0, 12)) {
    if (img.startsWith("url:")) {
      const url = img.slice(4);
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn(
            `[Flare BG] Failed to fetch image: ${resp.status} ${url.slice(0, 80)}`,
          );
          continue;
        }
        const blob = await resp.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce(
            (s, b) => s + String.fromCharCode(b),
            "",
          ),
        );
        const mimeType = blob.type || "image/jpeg";
        resolvedImages.push(`data:${mimeType};base64,${base64}`);
      } catch (err) {
        console.warn(`[Flare BG] Image fetch error: ${url.slice(0, 80)}`, err);
      }
    } else {
      resolvedImages.push(img);
    }
  }

  if (resolvedImages.length === 0) return [];

  const payload: ImageInput[] = resolvedImages.map((image, index) => ({
    id: `img_${index + 1}`,
    image,
  }));

  try {
    const response = await fetch(`${backendUrl}/detect/image/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: payload }),
    });

    if (!response.ok) {
      console.warn(
        `[Flare BG] /detect/image/batch returned ${response.status}`,
      );
      return [];
    }

    const data = (await response.json()) as BackendDetectionResponse;
    const results = data.details?.results ?? [];

    return results.map((result) => ({
      id: result.id,
      type: "image",
      score: normalizeBackendScore(result.score),
      tier: result.tier || tierFromPercent(normalizeBackendScore(result.score)),
      preview: result.id,
      provider: data.provider || "python-model",
      explanation: result.explanation ?? null,
    }));
  } catch (err) {
    console.warn("[Flare BG] Failed to analyze images:", err);
    return [];
  }
}

// ──────────────────────────────────────────────────────────
// Persistence / broadcast helpers
// ──────────────────────────────────────────────────────────

async function persistAnalysisForTab(
  tabId: number,
  analysis: PageAnalysis,
): Promise<void> {
  try {
    await chrome.storage.session.set({ [`tab_${tabId}`]: analysis });
  } catch (err) {
    console.warn("[Flare BG] Failed to persist analysis:", err);
  }
}

async function broadcastAnalysis(
  tabId: number,
  analysis: PageAnalysis,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "ANALYSIS_RESULT",
      payload: analysis,
    } satisfies ExtensionMessage);
  } catch (err) {
    console.warn("[Flare BG] Failed to message content script:", err);
  }

  try {
    await chrome.runtime.sendMessage({
      type: "ANALYSIS_RESULT",
      payload: analysis,
    } satisfies ExtensionMessage);
  } catch {
    // okay if no listener
  }
}

function updateActionBadge(tabId: number, score: number): void {
  chrome.action.setBadgeText({
    text: `${Math.round(score)}%`,
    tabId,
  });

  chrome.action.setBadgeBackgroundColor({
    color: score <= 40 ? "#22c55e" : score <= 70 ? "#eab308" : "#ef4444",
    tabId,
  });
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function normalizeBackendScore(score: number): number {
  if (score > 0 && score <= 1) return Math.round(score * 100);
  return Math.round(score);
}

function tierFromPercent(score: number): FlagTier {
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function generateCacheKey(
  url: string,
  containers: Array<{ id: string; text: string }>,
): string {
  const sample = containers
    .slice(0, 5)
    .map((c) => c.text.slice(0, 180))
    .join("|");

  return `${url}::${simpleHash(sample)}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

// ── Clear tab cache on navigation ──
const tabUrls = new Map<number, string>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const prevUrl = tabUrls.get(tabId);
  if (prevUrl !== tab.url) {
    tabUrls.set(tabId, tab.url);
    chrome.storage.session.remove(`tab_${tabId}`).catch(() => {});
    chrome.action.setBadgeText({ text: "", tabId }).catch?.(() => {});
  }
});
