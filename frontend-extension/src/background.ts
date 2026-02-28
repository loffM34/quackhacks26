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
  DEFAULT_SETTINGS,
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
  const cacheKey = generateCacheKey(extraction.url, extraction.paragraphs);

  // Check cache
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.analyzedAt < CACHE_TTL_MS) {
    console.log("[AI Shield BG] Cache hit for:", extraction.url);
    return { ...cached, cached: true };
  }

  // Analyze text paragraphs
  const textScores = await analyzeTexts(extraction.paragraphs);

  // Analyze images (if any)
  const imageScores = await analyzeImages(extraction.images);

  // Combine into page analysis
  const allItems = [...textScores, ...imageScores];
  const textAvg = average(textScores.map((s) => s.score));
  const imageAvg = average(imageScores.map((s) => s.score));
  const overallScore =
    allItems.length > 0 ? average(allItems.map((s) => s.score)) : 0;

  // Calculate AI density — % of paragraphs scoring above 50%
  const flaggedCount = textScores.filter((s) => s.score > 50).length;
  const aiDensity =
    textScores.length > 0
      ? Math.round((flaggedCount / textScores.length) * 100)
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
 */
async function handleManualAnalysis(
  tabId?: number,
): Promise<PageAnalysis | null> {
  if (!tabId) {
    // Get the active tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    tabId = tab?.id;
  }

  if (!tabId) return null;

  // Execute content extraction in the tab
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // This runs in the content script world — trigger extraction
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "EXTRACT_CONTENT_TRIGGER" },
          resolve,
        );
      });
    },
  });

  return results?.[0]?.result as PageAnalysis | null;
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
 * Send text paragraphs to the backend for AI detection scoring.
 * Batches all paragraphs in a single request for efficiency.
 */
async function analyzeTexts(paragraphs: string[]): Promise<ContentScore[]> {
  if (paragraphs.length === 0) return [];

  try {
    // Send combined text (join paragraphs with separator)
    const combinedText = paragraphs.join("\n\n");

    // Limit to 5000 characters total to stay within API limits
    const truncated = combinedText.slice(0, 5000);

    const response = await fetch(`${backendUrl}/detect/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: truncated, url: "" }),
    });

    if (!response.ok) {
      console.error("[AI Shield BG] Backend text API error:", response.status);
      return [];
    }

    const data: DetectTextResponse = await response.json();

    // Map to ContentScore items (one per paragraph if details available,
    // otherwise one overall score)
    if (data.details?.sentences && data.details.sentences.length > 0) {
      return data.details.sentences.slice(0, paragraphs.length).map((s, i) => ({
        id: `text-${i}`,
        type: "text" as const,
        score: Math.round(s.score * 100),
        preview: s.text.slice(0, 100),
        provider: data.provider,
      }));
    }

    // Single overall score — apply to each paragraph
    return paragraphs.map((p, i) => ({
      id: `text-${i}`,
      type: "text" as const,
      score: Math.round(data.score * 100),
      preview: p.slice(0, 100),
      provider: data.provider,
    }));
  } catch (err) {
    console.error("[AI Shield BG] Failed to analyze text:", err);
    return [];
  }
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
      scores.push({
        id: `img-${i}`,
        type: "image",
        score: Math.round(data.score * 100),
        preview: images[i].slice(0, 80),
        provider: data.provider,
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
function generateCacheKey(url: string, paragraphs: string[]): string {
  const contentSample = paragraphs.slice(0, 3).join("").slice(0, 200);
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

// ── Register side panel behavior ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(console.error);

console.log("[AI Shield] Background service worker initialized.");
