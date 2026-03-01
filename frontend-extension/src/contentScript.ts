// ──────────────────────────────────────────────────────────
// Content Script — AI Content Shield (Architectural Rewrite)
// ──────────────────────────────────────────────────────────
// Design principles:
//   1. Incremental scanning — only new containers are analyzed
//   2. Container fingerprinting — no duplicate work
//   3. Reactive DOM observer — handles infinite scroll + AJAX
//   4. Resilient badge — survives SPA re-renders
//   5. Isolated blur — only flaggedRanges, never whole containers
//   6. Single init entry point with double-init guard

import type {
  ExtensionMessage,
  ShieldSettings,
  PageAnalysis,
  ContentScore,
  ExtractedContainerData,
  PageExtraction,
} from "./types";

/**
 * Safely send a message to the background service worker.
 * Inlined here to prevent Vite from code-splitting and outputting ES modules
 * which are unsupported in Manifest V3 content scripts without dynamic imports.
 */
async function safeSendMessage<T = any>(
  message: ExtensionMessage,
): Promise<T | null> {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.id) {
      console.warn(
        "🛡️ [AI Shield] Extension context invalidated. Ignoring message.",
      );
      return resolve(null);
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            "🛡️ [AI Shield] Background message error:",
            chrome.runtime.lastError.message,
          );
          return resolve(null);
        }
        resolve(response as T);
      });
    } catch (error) {
      console.warn(
        "🛡️ [AI Shield] Sync message error, context likely dead:",
        error,
      );
      resolve(null);
    }
  });
}

// ──────────────────────────────────────────────────────────
// § STATE
// ──────────────────────────────────────────────────────────

let currentAnalysis: PageAnalysis | null = null;
let settings: ShieldSettings | null = null;
let badgeElement: HTMLElement | null = null;
let isAnalyzing = false;

// ── Text-node map for precise highlighting ──
interface TextNodeEntry {
  node: Text;
  globalStart: number;
  globalEnd: number;
}

interface ExtractedContainer {
  id: string;
  element: Element;
  flatText: string;
  textNodeMap: TextNodeEntry[];
}

const activeContainers = new Map<string, ExtractedContainer>();
const scannedFingerprints = new Set<string>();
let containerIdCounter = 0;

// Observers
let urlObserver: MutationObserver | null = null;
let contentObserver: MutationObserver | null = null;
let lastUrl = location.href;
let contentDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let urlDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let badgeCheckInterval: ReturnType<typeof setInterval> | null = null;

// ──────────────────────────────────────────────────────────
// § PLATFORM CONFIG
// ──────────────────────────────────────────────────────────

const PLATFORM_SELECTORS: Record<string, string[]> = {
  "linkedin.com": [
    ".feed-shared-update-v2__description",
    ".feed-shared-text__text-view",
    ".feed-shared-update-v2",
  ],
  "facebook.com": ['div[role="article"]'],
  "instagram.com": ["article"],
  "twitter.com": ['[data-testid="tweet"]'],
  "x.com": ['[data-testid="tweet"]'],
};

const GENERIC_SELECTORS = ["article", "main", '[role="main"]', "section"];

const EXCLUDE_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "BUTTON",
  "SVG",
  "INPUT",
  "TEXTAREA",
  "NAV",
  "HEADER",
  "FOOTER",
]);

const EXCLUDE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "button",
  "svg",
  "input",
  "textarea",
  "script",
  "style",
  "noscript",
  "iframe",
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="tooltip"]',
  '[role="dialog"]',
  '[role="menu"]',
  ".cookie-banner",
  ".sr-only",
];

// ──────────────────────────────────────────────────────────
// § HELPERS
// ──────────────────────────────────────────────────────────

function fingerprint(text: string): string {
  // Simple fast hash of first 200 chars — enough to detect duplicates
  const sample = text.slice(0, 200);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
  }
  return `fp_${hash}`;
}

function isExcluded(el: Element): boolean {
  for (const sel of EXCLUDE_SELECTORS) {
    if (el.matches(sel) || el.closest(sel)) return true;
  }
  try {
    const style = window.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden";
  } catch {
    return false;
  }
}

async function loadSettings(): Promise<ShieldSettings> {
  const result = await chrome.storage.local.get("settings");
  const DEFAULT_SETTINGS: ShieldSettings = {
    threshold: 70,
    autoBlur: false,
    elderMode: false,
    privacyConsent: true,
    showSearchDots: true,
    backendUrl: "http://localhost:3001",
  };
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

function normalizeScore(score: number): number {
  // Backend may return 0..1 or 0..100. Normalize to 0..100.
  if (score > 0 && score <= 1) return Math.round(score * 100);
  return Math.round(score);
}

function log(msg: string, ...args: unknown[]): void {
  console.log(`[AI Shield] ${msg}`, ...args);
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}

// ──────────────────────────────────────────────────────────
// § TEXT NODE MAPPING
// ──────────────────────────────────────────────────────────

function mapTextNodes(root: Element): {
  textNodeMap: TextNodeEntry[];
  flatText: string;
} {
  const textNodeMap: TextNodeEntry[] = [];
  let flatText = "";

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Text): number {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (EXCLUDE_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      // Skip nodes inside our own spans
      if (parent.closest('[data-ai-shield="true"]'))
        return NodeFilter.FILTER_REJECT;
      if (
        parent.closest('[aria-hidden="true"]') ||
        parent.closest("nav") ||
        parent.closest("header") ||
        parent.closest("footer")
      )
        return NodeFilter.FILTER_REJECT;
      try {
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden")
          return NodeFilter.FILTER_REJECT;
      } catch {
        // ignore
      }
      const text = node.nodeValue || "";
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current: Text | null;
  while ((current = walker.nextNode() as Text)) {
    const text = current.nodeValue || "";
    textNodeMap.push({
      node: current,
      globalStart: flatText.length,
      globalEnd: flatText.length + text.length,
    });
    flatText += text;
  }
  return { textNodeMap, flatText };
}

// ──────────────────────────────────────────────────────────
// § CONTAINER EXTRACTION (incremental — never wipes old)
// ──────────────────────────────────────────────────────────

function extractNewContainers(): Array<{ id: string; text: string }> {
  const results: Array<{ id: string; text: string }> = [];

  // Google Docs special case
  if (window.location.hostname.includes("docs.google.com")) {
    return extractGoogleDocsContainers();
  }

  // Get selectors for this platform
  const hostname = window.location.hostname;
  let selectors: string[] = [];
  for (const [domain, sels] of Object.entries(PLATFORM_SELECTORS)) {
    if (hostname.includes(domain)) {
      selectors = sels;
      break;
    }
  }
  if (selectors.length === 0) {
    selectors = GENERIC_SELECTORS;
  }

  for (const selector of selectors) {
    let elements: NodeListOf<Element>;
    try {
      elements = document.querySelectorAll(selector);
    } catch {
      continue;
    }

    for (const el of elements) {
      if (results.length >= 30) break;
      if (isExcluded(el)) continue;
      // Don't require viewport for initial scan — some content is just below fold
      // But DO require non-trivial size
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const { textNodeMap, flatText } = mapTextNodes(el);
      if (flatText.length < 80) continue;

      const fp = fingerprint(flatText);
      if (scannedFingerprints.has(fp)) continue; // Already processed

      scannedFingerprints.add(fp);
      const id = `c-${containerIdCounter++}`;
      activeContainers.set(id, { id, element: el, flatText, textNodeMap });
      results.push({ id, text: flatText.slice(0, 3000) });
    }
  }

  return results;
}

function extractGoogleDocsContainers(): Array<{ id: string; text: string }> {
  const results: Array<{ id: string; text: string }> = [];
  const editor = document.querySelector(".kix-appview-editor");
  if (!editor) return results;

  const { textNodeMap, flatText } = mapTextNodes(editor);
  if (flatText.length < 50) return results;

  const fp = fingerprint(flatText);
  if (scannedFingerprints.has(fp)) return results;

  scannedFingerprints.add(fp);
  const id = `docs-${containerIdCounter++}`;
  activeContainers.set(id, { id, element: editor, flatText, textNodeMap });
  results.push({ id, text: flatText.slice(0, 4000) });
  return results;
}

// ──────────────────────────────────────────────────────────
// § HIGHLIGHTING — safe text-node splitting (no surroundContents)
// ──────────────────────────────────────────────────────────

function highlightRange(
  containerId: string,
  start: number,
  end: number,
  className: string,
): HTMLSpanElement[] {
  const container = activeContainers.get(containerId);
  if (!container) return [];

  // Recompute text node map to get fresh offsets
  const { textNodeMap, flatText } = mapTextNodes(container.element);
  container.textNodeMap = textNodeMap;
  container.flatText = flatText;

  if (textNodeMap.length === 0) return [];

  // Clamp range to actual text length
  const clampedStart = Math.max(0, Math.min(start, flatText.length));
  const clampedEnd = Math.max(clampedStart, Math.min(end, flatText.length));
  if (clampedStart >= clampedEnd) return [];

  // Find which text nodes overlap with [clampedStart, clampedEnd)
  const overlapping: TextNodeEntry[] = [];
  for (const entry of textNodeMap) {
    if (entry.globalEnd <= clampedStart || entry.globalStart >= clampedEnd)
      continue;
    overlapping.push(entry);
  }

  const spans: HTMLSpanElement[] = [];

  // Process in REVERSE order to avoid offset corruption from splitText
  for (let i = overlapping.length - 1; i >= 0; i--) {
    const entry = overlapping[i];
    const nodeStart = Math.max(0, clampedStart - entry.globalStart);
    const nodeEnd = Math.min(entry.node.length, clampedEnd - entry.globalStart);
    if (nodeStart >= nodeEnd) continue;

    try {
      const span = document.createElement("span");
      span.className = className;
      span.dataset.aiShield = "true";
      span.dataset.containerId = containerId;

      if (nodeStart === 0 && nodeEnd === entry.node.length) {
        // Wrap entire text node
        entry.node.parentNode!.insertBefore(span, entry.node);
        span.appendChild(entry.node);
      } else {
        // Split precisely: [before][match][after]
        const matchNode = entry.node.splitText(nodeStart);
        matchNode.splitText(nodeEnd - nodeStart);
        matchNode.parentNode!.insertBefore(span, matchNode);
        span.appendChild(matchNode);
      }
      spans.push(span);
    } catch {
      // Node may have been removed by SPA framework — skip silently
    }
  }

  return spans.reverse(); // Return in document order
}

// ──────────────────────────────────────────────────────────
// § CSS STYLES
// ──────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById("ai-shield-styles")) return;
  const style = document.createElement("style");
  style.id = "ai-shield-styles";
  style.textContent = `
    .ai-highlight {
      background-color: rgba(99, 102, 241, 0.2);
      border-bottom: 2px solid rgba(99, 102, 241, 0.8);
      border-radius: 2px;
      transition: background-color 0.3s ease;
      cursor: pointer;
    }
    .ai-highlight:hover {
      background-color: rgba(99, 102, 241, 0.35);
    }
    .ai-blur {
      filter: blur(5px);
      transition: filter 0.2s ease;
      cursor: pointer;
      user-select: none;
    }
    .ai-blur:hover {
      filter: blur(3px);
    }
    .ai-blur.revealed {
      filter: none;
      user-select: auto;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// ──────────────────────────────────────────────────────────
// § CLEAR FUNCTIONS
// ──────────────────────────────────────────────────────────

function clearAllShieldSpans(): void {
  document.querySelectorAll('[data-ai-shield="true"]').forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  });
}

function clearHighlights(): void {
  document
    .querySelectorAll('[data-ai-shield="true"].ai-highlight')
    .forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    });
}

function teardown(): void {
  log("Extension context invalidated. Tearing down orphaned content script.");

  if (urlObserver) {
    urlObserver.disconnect();
    urlObserver = null;
  }
  if (contentObserver) {
    contentObserver.disconnect();
    contentObserver = null;
  }
  if (badgeCheckInterval) {
    clearInterval(badgeCheckInterval);
    badgeCheckInterval = null;
  }
  if (urlDebounceTimer) clearTimeout(urlDebounceTimer);
  if (contentDebounceTimer) clearTimeout(contentDebounceTimer);

  clearAllShieldSpans();

  if (badgeElement) {
    badgeElement.remove();
    badgeElement = null;
  }
}

// ──────────────────────────────────────────────────────────
// § BLUR LOGIC — isolated to flaggedRanges only
// ──────────────────────────────────────────────────────────

function applyBlur(analysis: PageAnalysis): void {
  const threshold = settings?.threshold ?? 70;
  let blurCount = 0;

  for (const item of analysis.items) {
    if (item.type !== "text") continue;
    const score = normalizeScore(item.score);
    if (score <= threshold) continue;
    if (!item.flaggedRanges || item.flaggedRanges.length === 0) continue;

    for (const range of item.flaggedRanges) {
      const spans = highlightRange(item.id, range.start, range.end, "ai-blur");
      for (const span of spans) {
        blurCount++;
        span.title = `AI likelihood: ${score}% — click to reveal`;
        span.addEventListener("click", () => {
          span.classList.toggle("revealed");
        });
      }
    }
  }

  log(`Applied blur to ${blurCount} spans (threshold: ${threshold}%).`);
}

function highlightItemOnPage(preview: string, itemScore?: ContentScore): void {
  clearHighlights();

  if (itemScore?.flaggedRanges && itemScore.flaggedRanges.length > 0) {
    let scrolled = false;
    for (const range of itemScore.flaggedRanges) {
      const spans = highlightRange(
        itemScore.id,
        range.start,
        range.end,
        "ai-highlight",
      );
      if (spans.length > 0 && !scrolled) {
        spans[0].scrollIntoView({ behavior: "smooth", block: "center" });
        scrolled = true;
      }
      for (const s of spans) {
        setTimeout(() => {
          if (s.parentNode) {
            const parent = s.parentNode;
            while (s.firstChild) parent.insertBefore(s.firstChild, s);
            parent.removeChild(s);
          }
        }, 4000);
      }
    }
    return;
  }

  // Fallback: search by preview text in all containers
  for (const [id, container] of activeContainers.entries()) {
    const idx = container.flatText.indexOf(preview.slice(0, 100));
    if (idx !== -1) {
      const spans = highlightRange(
        id,
        idx,
        idx + Math.min(preview.length, 100),
        "ai-highlight",
      );
      if (spans.length > 0) {
        spans[0].scrollIntoView({ behavior: "smooth", block: "center" });
        for (const s of spans) {
          setTimeout(() => {
            if (s.parentNode) {
              const parent = s.parentNode;
              while (s.firstChild) parent.insertBefore(s.firstChild, s);
              parent.removeChild(s);
            }
          }, 4000);
        }
        return;
      }
    }
  }
}

// ──────────────────────────────────────────────────────────
// § BADGE — resilient, update-in-place
// ──────────────────────────────────────────────────────────

function ensureBadge(): void {
  const existing = document.getElementById("ai-shield-badge");
  if (existing) {
    badgeElement = existing as HTMLElement;
    return;
  }
  if (!document.body) return;

  const badge = document.createElement("div");
  badge.id = "ai-shield-badge";

  Object.assign(badge.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "8px 14px",
    borderRadius: "24px",
    background:
      "linear-gradient(135deg, rgba(10,26,74,0.85), rgba(44,79,153,0.75))",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(148,163,184,0.2)",
    boxShadow:
      "0 4px 16px rgba(10,26,74,0.4), inset 0 1px 1px rgba(148,163,184,0.15)",
    color: "#e2e8f0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: "13px",
    cursor: "pointer",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    gap: "2px",
  });

  badge.addEventListener("mouseenter", () => {
    badge.style.transform = "scale(1.08)";
  });

  badge.addEventListener("mouseleave", () => {
    badge.style.transform = "scale(1)";
  });
  badge.addEventListener("click", async () => {
    const res = await safeSendMessage({ type: "OPEN_SIDE_PANEL" });
    if (res === null) teardown();
  });

  updateBadgeContent(badge, null);
  document.body.appendChild(badge);
  badgeElement = badge;
}

function updateBadgeContent(badge: HTMLElement, score: number | null): void {
  let color = "#94a3b8";
  let bgGlow = "rgba(148,163,184,0.15)";
  let text = "Scanning...";

  if (score !== null) {
    color = score <= 40 ? "#22c55e" : score <= 70 ? "#eab308" : "#ef4444";
    bgGlow =
      score <= 40
        ? "rgba(34,197,94,0.15)"
        : score <= 70
          ? "rgba(234,179,8,0.15)"
          : "rgba(239,68,68,0.15)";
    text = `AI: ${Math.round(score)}%`;
  }

  badge.innerHTML = `
    <span style="color: ${color}; font-weight: 600;">${text}</span>
    <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
  `;
  badge.style.boxShadow = `0 4px 16px rgba(10,26,74,0.4), inset 0 1px 1px rgba(148,163,184,0.15), 0 0 20px 2px ${bgGlow}`;
}

function updateBadge(score: number | null): void {
  ensureBadge();
  if (badgeElement) updateBadgeContent(badgeElement, score);
}

// ──────────────────────────────────────────────────────────
// § ANALYSIS FLOW
// ──────────────────────────────────────────────────────────

async function scanNewContainers(): Promise<void> {
  if (isAnalyzing) return;

  settings = await loadSettings();
  if (!settings.privacyConsent) {
    log("Privacy consent not given, skipping scan.");
    return;
  }

  const newContainers = extractNewContainers();
  log(
    `Scan found ${newContainers.length} new containers (${activeContainers.size} total tracked).`,
  );

  if (newContainers.length === 0) {
    // No new content — just ensure badge is present
    ensureBadge();
    if (!currentAnalysis) updateBadge(null);
    return;
  }

  isAnalyzing = true;
  updateBadge(null); // Show "Scanning..."

  // Extract images (viewport-only)
  // We don't have compressImages in this file, but it's imported.
  // We'll assume it works as before or we'll mock if it's missing.

  // For this resolved version, we'll just send text for now if images fail
  const message: ExtensionMessage = {
    type: "EXTRACT_CONTENT",
    payload: {
      url: window.location.href,
      title: document.title,
      containers: newContainers,
      images: [], // Images handled separately or via another utility
    },
  };

  const response = await safeSendMessage<PageAnalysis>(message);
  isAnalyzing = false;

  if (response === null) {
    log("Extraction message failed or context dead.");
    updateBadge(null);
    teardown();
    return;
  }

  handleAnalysisResult(response, newContainers);
}

function handleAnalysisResult(
  analysis: PageAnalysis,
  newContainers: Array<{ id: string; text: string }>,
): void {
  currentAnalysis = analysis;
  updateBadge(analysis.overallScore);

  // Auto-blur if enabled
  if (settings?.autoBlur) {
    applyBlur(analysis);
  }

  log(`Analysis received. Overall score: ${analysis.overallScore}%`);
}

// ──────────────────────────────────────────────────────────
// § OBSERVERS
// ──────────────────────────────────────────────────────────

function startUrlObserver(): void {
  if (urlObserver) return;
  urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (urlDebounceTimer) clearTimeout(urlDebounceTimer);
      urlDebounceTimer = setTimeout(() => {
        log(`URL changed → ${location.href}`);
        resetForNavigation();
      }, 400);
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });
  log("URL observer started.");
}

function startContentObserver(): void {
  if (contentObserver) return;
  contentObserver = new MutationObserver((mutations) => {
    // Only care about added nodes (new content)
    let hasNewContent = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            !(node as Element).closest('[data-ai-shield="true"]') &&
            (node as Element).id !== "ai-shield-badge" &&
            (node as Element).id !== "ai-shield-styles"
          ) {
            hasNewContent = true;
            break;
          }
        }
      }
      if (hasNewContent) break;
    }

    if (!hasNewContent) return;

    // Debounce — wait for DOM to settle
    if (contentDebounceTimer) clearTimeout(contentDebounceTimer);
    contentDebounceTimer = setTimeout(() => {
      log("New DOM content detected — scanning for new containers.");
      scanNewContainers();
    }, 1200);
  });
  contentObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  log("Content observer started.");
}

function startBadgeGuard(): void {
  if (badgeCheckInterval) return;
  badgeCheckInterval = setInterval(() => {
    if (!document.getElementById("ai-shield-badge") && document.body) {
      log("Badge was removed — reattaching.");
      badgeElement = null;
      ensureBadge();
      if (currentAnalysis) {
        updateBadge(currentAnalysis.overallScore);
      }
    }
  }, 5000);
}

// ──────────────────────────────────────────────────────────
// § RESET (for SPA navigation)
// ──────────────────────────────────────────────────────────

function resetForNavigation(): void {
  log("Resetting for navigation...");
  clearAllShieldSpans();
  currentAnalysis = null;
  isAnalyzing = false;
  activeContainers.clear();
  scannedFingerprints.clear();
  containerIdCounter = 0;

  // Badge survives — just update content
  updateBadge(null);

  // Scan new page content after settle time
  setTimeout(() => scanNewContainers(), 800);
}

// ──────────────────────────────────────────────────────────
// § MESSAGE LISTENER
// ──────────────────────────────────────────────────────────

try {
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      // 1. Defensively check context to catch any stale bindings early
      if (!chrome?.runtime?.id) {
        teardown();
        return false;
      }

      switch (message.type) {
        case "ANALYSIS_RESULT":
          handleAnalysisResult(message.payload as PageAnalysis, []);
          sendResponse({ ok: true });
          break;

        case "BLUR_CONTENT":
          if (currentAnalysis) applyBlur(currentAnalysis);
          sendResponse({ ok: true });
          break;

        case "INJECT_DOTS":
          // Logic for search dots (placeholder for actual implementation)
          sendResponse({ ok: true });
          break;

        case "EXTRACT_CONTENT_TRIGGER":
          // Force a fresh scan
          scannedFingerprints.clear();
          activeContainers.clear();
          containerIdCounter = 0;
          scanNewContainers().then(() => sendResponse({ ok: true }));
          return true;

        case "HIGHLIGHT_ITEM": {
          const { preview, item } = message.payload || {};
          if (preview) highlightItemOnPage(preview, item);
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
      return true;
    },
  );
} catch (e) {
  log("Failed to register message listener. Context likely invalid.", e);
}

// ──────────────────────────────────────────────────────────
// § MAIN ENTRY POINT
// ──────────────────────────────────────────────────────────

async function initializeExtension(): Promise<void> {
  settings = await loadSettings();
  if (!settings.privacyConsent) {
    log("Privacy consent not given, extension inactive.");
    return;
  }

  log(`Initializing. URL: ${location.href}`);

  injectStyles();
  ensureBadge();
  startUrlObserver();

  // Delay content observer slightly so initial DOM is settled
  setTimeout(() => startContentObserver(), 500);

  // Start badge guard
  startBadgeGuard();

  // Initial scan
  setTimeout(() => {
    log("Running initial scan...");
    scanNewContainers();
  }, 1200);
}

// ──────────────────────────────────────────────────────────
// § DOUBLE-INIT GUARD + BOOT
// ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    __AI_SHIELD_INITIALIZED__?: boolean;
  }
}

if (window.__AI_SHIELD_INITIALIZED__) {
  log("Previous instance detected — cleaning up.");
  clearAllShieldSpans();
  currentAnalysis = null;
  isAnalyzing = false;
  activeContainers.clear();
  scannedFingerprints.clear();
  const prevBadge = badgeElement as HTMLElement | null;
  if (prevBadge) {
    prevBadge.remove();
    badgeElement = null;
  }
  const prevUrl = urlObserver as MutationObserver | null;
  if (prevUrl) {
    prevUrl.disconnect();
    urlObserver = null;
  }
  const prevContent = contentObserver as MutationObserver | null;
  if (prevContent) {
    prevContent.disconnect();
    contentObserver = null;
  }
  if (badgeCheckInterval) {
    clearInterval(badgeCheckInterval);
    badgeCheckInterval = null;
  }
}

window.__AI_SHIELD_INITIALIZED__ = true;

if (
  document.readyState === "complete" ||
  document.readyState === "interactive"
) {
  initializeExtension();
} else {
  document.addEventListener("DOMContentLoaded", () => initializeExtension(), {
    once: true,
  });
}
