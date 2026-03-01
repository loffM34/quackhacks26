// ──────────────────────────────────────────────────────────
// Background Service Worker — AI Content Shield
// ──────────────────────────────────────────────────────────
// MV3 service worker. Receives page extractions from content scripts,
// calls the backend gateway for AI detection, caches results in
// chrome.storage.session, and broadcasts results back to content scripts
// and the popup/sidepanel UI.

import type {
  ExtensionMessage,
  PageAnalysis,
  PageExtraction,
  DetectTextResponse,
  DetectImageResponse,
  ContentScore,
  ShieldSettings,
  FlagTier,
} from "./types";

// ── In-memory session cache (survives across tabs, cleared on SW restart) ──
const resultCache = new Map<string, PageAnalysis>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Default backend URL (overridden by settings) ──
let backendUrl = "http://localhost:3001";

// ── Load settings on startup ──
chrome.storage.sync.get("settings", (result) => {
  if (result.settings?.backendUrl) {
    backendUrl = result.settings.backendUrl;
  }
});

// ──────────────────────────────────────────────────────────
// Message listener — central hub for all extension messages
// ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    // Handle each message type
    switch (message.type) {
      case "EXTRACT_CONTENT":
        // Content script extracted page content — analyze it
        handleExtraction(message.payload as PageExtraction, sender.tab?.id)
          .then(sendResponse)
          .catch((err) => {
            console.error("[AI Shield BG] Analysis error:", err);
            sendResponse(null);
          });
        return true; // keep channel open for async response

      case "ANALYZE_REQUEST":
        // User clicked "Analyze" button — re-analyze current active tab
        handleManualAnalysis(sender.tab?.id)
          .then(sendResponse)
          .catch(() => sendResponse(null));
        return true;

      case "GET_RESULT":
        // UI requesting cached result for current tab
        handleGetResult(sender.tab?.id).then(sendResponse);
        return true;

      case "UPDATE_SETTINGS":
        // Settings changed — persist and update local state
        handleUpdateSettings(message.payload as Partial<ShieldSettings>);
        sendResponse({ ok: true });
        break;

      case "OPEN_SIDE_PANEL":
        // Badge clicked — open the side panel
        if (sender.tab?.id) {
          chrome.sidePanel.open({ tabId: sender.tab.id }).catch(console.error);
        }
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  },
);

// ──────────────────────────────────────────────────────────
// Analysis logic
// ──────────────────────────────────────────────────────────

/**
 * Handle content extraction from a page.
 * Checks cache first, then calls backend for uncached content.
 */
async function handleExtraction(
  extraction: PageExtraction,
  tabId?: number,
): Promise<PageAnalysis | null> {
  const cacheKey = generateCacheKey(extraction.url, extraction.containers);

  // Check cache
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.analyzedAt < CACHE_TTL_MS) {
    console.log("[AI Shield BG] Cache hit for:", extraction.url);
    return { ...cached, cached: true };
  }

  // Analyze text containers
  const textScores = await analyzeContainers(extraction.containers);

  // Analyze images (if any)
  const imageScores = await analyzeImages(extraction.images);

  // Combine into page analysis
  const allItems = [...textScores, ...imageScores];
  const textAvg = average(textScores.map((s) => s.score));
  const imageAvg = average(imageScores.map((s) => s.score));
  const overallScore =
    allItems.length > 0 ? average(allItems.map((s) => s.score)) : 0;

  // Calculate AI density — % of items flagged as medium/high
  const flaggedCount = allItems.filter(
    (s) => s.tier === "medium" || s.tier === "high",
  ).length;
  const aiDensity =
    allItems.length > 0
      ? Math.round((flaggedCount / allItems.length) * 100)
      : 0;

  const analysis: PageAnalysis = {
    overallScore: Math.round(overallScore),
    textScore: Math.round(textAvg),
    imageScore: Math.round(imageAvg),
    aiDensity,
    items: allItems,
    url: extraction.url,
    analyzedAt: Date.now(),
    cached: false,
  };

  // Cache result
  resultCache.set(cacheKey, analysis);

  // Also store in chrome.storage.session for popup/sidepanel access
  if (tabId) {
    chrome.storage.session
      .set({ [`tab_${tabId}`]: analysis })
      .catch(console.error);
  }

  // Update badge text on the extension icon
  if (tabId) {
    chrome.action.setBadgeText({ text: `${analysis.overallScore}%`, tabId });
    chrome.action.setBadgeBackgroundColor({
      color:
        analysis.overallScore <= 40
          ? "#22c55e"
          : analysis.overallScore <= 70
            ? "#eab308"
            : "#ef4444",
      tabId,
    });
  }

  return analysis;
}

/**
 * Handle manual "Analyze" button press — extract and analyze the active tab.
 * The flow: trigger content script → it extracts → sends EXTRACT_CONTENT back
 * to background → handleExtraction runs → stores in session storage.
 * We poll session storage for the fresh result.
 */
async function handleManualAnalysis(
  tabId?: number,
): Promise<PageAnalysis | null> {
  if (!tabId) {
    // Get the active tab (popup/sidepanel don't have sender.tab)
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tab?.id;
  }

  if (!tabId) return null;

  // Trigger fresh extraction in the content script
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId!,
      { type: "EXTRACT_CONTENT_TRIGGER" },
      (_response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "[AI Shield BG] Manual analysis trigger failed:",
            chrome.runtime.lastError.message,
          );
          resolve(null);
          return;
        }

        // The content script will send EXTRACT_CONTENT back to us,
        // which handleExtraction processes and stores in session storage.
        // Poll for the result (it takes 1-3 seconds for the backend call).
        const pollKey = `tab_${tabId}`;
        let attempts = 0;
        const maxAttempts = 15; // 15 * 500ms = 7.5s max wait

        const poll = setInterval(async () => {
          attempts++;
          try {
            const stored = await chrome.storage.session.get(pollKey);
            const result = stored[pollKey] as PageAnalysis | undefined;
            if (result && Date.now() - result.analyzedAt < 10000) {
              // Fresh result found
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
      },
    );
  });
}

/**
 * Get cached result for a tab.
 */
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

/**
 * Persist updated settings.
 */
async function handleUpdateSettings(
  partial: Partial<ShieldSettings>,
): Promise<void> {
  const current = await chrome.storage.sync.get("settings");
  const updated = { ...(current.settings || {}), ...partial };
  await chrome.storage.sync.set({ settings: updated });

  if (updated.backendUrl) {
    backendUrl = updated.backendUrl;
  }
}

// ──────────────────────────────────────────────────────────
// Backend API calls
// ──────────────────────────────────────────────────────────

/**
 * Send each container to the backend individually for per-container scoring (e.g. per social post).
 */
async function analyzeContainers(
  containers: Array<{ id: string; text: string }>,
): Promise<ContentScore[]> {
  if (containers.length === 0) return [];

  const scores: ContentScore[] = [];

  // Send containers individually (limit to 10 to avoid rate limiting)
  const toAnalyze = containers.slice(0, 10);

  for (let i = 0; i < toAnalyze.length; i++) {
    const container = toAnalyze[i];
    const text = container.text.slice(0, 2000); // enforce max length

    // DistilBERT model requirement: minimum 60 words for accurate detection
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    if (wordCount < 60) continue; // skip blocks under 60 words

    try {
      const response = await fetch(`${backendUrl}/detect/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        console.warn(
          `[AI Shield BG] Backend returned ${response.status} for container ${container.id}`,
        );
        continue;
      }

      const data: DetectTextResponse = await response.json();
      const score = Math.round(data.score * 100);
      const tier: FlagTier =
        score <= 40 ? "low" : score <= 70 ? "medium" : "high";

      scores.push({
        id: container.id,
        type: "text",
        score,
        tier,
        preview: text.slice(0, 100),
        provider: data.provider,
        flaggedRanges: data.flaggedRanges,
        explanation: (data as any).explanation ?? null,
      });
    } catch (err) {
      console.warn(
        `[AI Shield BG] Failed to analyze container ${container.id}:`,
        err,
      );
    }
  }

  return scores;
}

/**
 * Send images to the backend for AI-generated image detection.
 */
async function analyzeImages(images: string[]): Promise<ContentScore[]> {
  if (images.length === 0) return [];

  const scores: ContentScore[] = [];

  for (let i = 0; i < images.length; i++) {
    try {
      const response = await fetch(`${backendUrl}/detect/image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: images[i] }),
      });

      if (!response.ok) continue;

      const data: DetectImageResponse = await response.json();
      const score = Math.round(data.score * 100);
      const tier: FlagTier =
        score <= 40 ? "low" : score <= 70 ? "medium" : "high";

      scores.push({
        id: `img-${i}`,
        type: "image",
        score,
        tier,
        preview: images[i].slice(0, 80),
        provider: data.provider,
        explanation: (data as any).explanation ?? null,
      });
    } catch (err) {
      console.warn("[AI Shield BG] Image analysis failed for image", i, err);
    }
  }

  return scores;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

/** Generate a cache key from URL + content hash */
function generateCacheKey(
  url: string,
  containers: { id: string; text: string }[],
): string {
  const contentSample = containers
    .slice(0, 3)
    .map((c) => c.text)
    .join("")
    .slice(0, 200);
  return `${url}::${simpleHash(contentSample)}`;
}

/** Simple string hash for cache keys */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // 32-bit integer
  }
  return hash.toString(36);
}

/** Average of an array of numbers */
function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ── Rescan on traditional navigation ──
const tabUrls = new Map<number, string>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  const prevUrl = tabUrls.get(tabId);
  tabUrls.set(tabId, tab.url);

  // Only trigger if the URL actually changed
  if (prevUrl && prevUrl !== tab.url) {
    chrome.tabs
      .sendMessage(tabId, { type: "EXTRACT_CONTENT_TRIGGER" })
      .catch(() => {
        // Content script not ready yet — ignore
      });
  }
});

// ── Register side panel behavior ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(console.error);

console.log("[AI Shield] Background service worker initialized.");
