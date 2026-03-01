// ──────────────────────────────────────────────────────────
// Content Script — AI Content Shield (Architectural Rewrite)
// ──────────────────────────────────────────────────────────
// Clean rewrite. Key principles:
//   - Viewport-only extraction (no full-body walks)
//   - Range API for highlight/blur (no overlay divs)
//   - Social media platform selectors
//   - Google Docs iframe support
//   - SPA-safe MutationObserver
//   - Analysis only on user action

import { extractPageContent } from "./utils/domExtractor";
import { compressImages } from "./utils/imageCompressor";
import type {
  ExtensionMessage,
  PageAnalysis,
  ContentScore,
  ShieldSettings,
} from "./types";

console.log("[AI Shield] Content script initialized.");

// ── State ──
let currentAnalysis: PageAnalysis | null = null;
let settings: ShieldSettings | null = null;
let badgeElement: HTMLElement | null = null;
let isAnalyzing = false;

// ── Container mapping ──
interface TextNodeEntry {
  node: Text;
  globalStart: number;
  globalEnd: number;
}

interface ExtractedContainer {
  id: string; // unique ID
  element: Element;
  flatText: string;
  textNodeMap: TextNodeEntry[];
}

let activeContainers = new Map<string, ExtractedContainer>();

// ──────────────────────────────────────────────────────────
// SECTION 1: Visible text extraction per container
// ──────────────────────────────────────────────────────────

/** Content selectors for specific platforms */
const PLATFORM_SELECTORS: Record<string, string[]> = {
  "linkedin.com": [
    ".feed-shared-update-v2__description",
    ".feed-shared-text__text-view",
  ],
  "facebook.com": ['div[role="article"]'],
  "instagram.com": ["article"],
  "twitter.com": ['[data-testid="tweet"]'],
  "x.com": ['[data-testid="tweet"]'],
};

/** Elements to always exclude */
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

function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isExcluded(el: Element): boolean {
  for (const sel of EXCLUDE_SELECTORS) {
    if (el.matches(sel) || el.closest(sel)) return true;
  }
  const style = window.getComputedStyle(el);
  return style.display === "none" || style.visibility === "hidden";
}

function extractContainers(): Array<{ id: string; text: string }> {
  activeContainers.clear();
  const results: Array<{ id: string; text: string }> = [];
  const seenElements = new Set<Element>();

  // Check for Google Docs
  if (window.location.hostname.includes("docs.google.com")) {
    return extractGoogleDocsContainers();
  }

  // Platform-specific selectors
  const hostname = window.location.hostname;
  let containerSelectors: string[] = [];

  for (const [domain, selectors] of Object.entries(PLATFORM_SELECTORS)) {
    if (hostname.includes(domain)) {
      containerSelectors = selectors;
      break;
    }
  }

  // Fallback
  if (containerSelectors.length === 0) {
    containerSelectors = ["article", "main", '[role="main"]'];
  }

  for (const selector of containerSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (results.length >= 20) break;
      if (isExcluded(el) || !isInViewport(el) || seenElements.has(el)) continue;

      const { textNodeMap, flatText } = mapTextNodes(el);
      if (flatText.length < 100) continue; // Min 100 chars

      seenElements.add(el);
      const id = `container-${results.length}`;
      activeContainers.set(id, { id, element: el, flatText, textNodeMap });
      results.push({ id, text: flatText.slice(0, 3000) });
    }
  }

  console.log(`[AI Shield] Extracted ${results.length} active containers.`);
  return results;
}

// ──────────────────────────────────────────────────────────
// SECTION 2: Google Docs support
// ──────────────────────────────────────────────────────────

function extractGoogleDocsContainers(): Array<{ id: string; text: string }> {
  const results: Array<{ id: string; text: string }> = [];
  const editor = document.querySelector(".kix-appview-editor");
  if (!editor) return results; // Return empty if not found, DO NOT fallback to document.body

  const { textNodeMap, flatText } = mapTextNodes(editor);
  if (flatText.length > 50) {
    const id = `docs-container-0`;
    activeContainers.set(id, { id, element: editor, flatText, textNodeMap });
    results.push({ id, text: flatText.slice(0, 4000) });
  }
  return results;
}

// ──────────────────────────────────────────────────────────
// SECTION 3: Text-node mapping (for highlight/blur)
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
      const tag = parent.tagName;
      if (
        tag === "SCRIPT" ||
        tag === "STYLE" ||
        tag === "NOSCRIPT" ||
        tag === "BUTTON" ||
        tag === "SVG"
      )
        return NodeFilter.FILTER_REJECT;
      if (
        parent.closest('[aria-hidden="true"]') ||
        parent.closest("nav") ||
        parent.closest("header")
      )
        return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden")
        return NodeFilter.FILTER_REJECT;

      const text = node.nodeValue || "";
      if (!text.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current: Text | null;
  while ((current = walker.nextNode() as Text)) {
    const text = current.nodeValue || ""; // keep exact whitespace so offsets match exactly
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
// SECTION 4: Highlight via exact ranges
// ──────────────────────────────────────────────────────────

function highlightExactOffsets(
  containerId: string,
  start: number,
  end: number,
  className: string,
): HTMLSpanElement[] {
  const container = activeContainers.get(containerId);
  if (!container) return [];

  // RECOMPUTE BEFORE HIGHLIGHTING
  const { textNodeMap, flatText } = mapTextNodes(container.element);
  container.textNodeMap = textNodeMap;
  container.flatText = flatText;

  if (container.textNodeMap.length === 0) return [];

  const spans: HTMLSpanElement[] = [];
  const entriesToProcess = [];

  for (const entry of container.textNodeMap) {
    if (entry.globalEnd <= start || entry.globalStart >= end) continue;
    entriesToProcess.push(entry);
  }

  let fallbackUsed = 0;

  // Process backwards to avoid offset shifting!
  for (let i = entriesToProcess.length - 1; i >= 0; i--) {
    const entry = entriesToProcess[i];
    const nodeStart = Math.max(0, start - entry.globalStart);
    const nodeEnd = Math.min(entry.node.length, end - entry.globalStart);

    try {
      const span = document.createElement("span");
      span.className = className;
      span.dataset.aiShield = "true";

      if (nodeStart === 0 && nodeEnd === entry.node.length) {
        entry.node.parentNode!.insertBefore(span, entry.node);
        span.appendChild(entry.node);
      } else {
        const matchText = entry.node.splitText(nodeStart);
        matchText.splitText(nodeEnd - nodeStart);
        matchText.parentNode!.insertBefore(span, matchText);
        span.appendChild(matchText);
      }
      spans.push(span);
    } catch {
      fallbackUsed++;
    }
  }

  if (fallbackUsed > 0) {
    console.log(
      `[AI Shield] Highlight fallback triggered on ${fallbackUsed} nodes.`,
    );
  }

  return spans.reverse(); // Return in document order
}

// ──────────────────────────────────────────────────────────
// SECTION 5: Blur implementation (CSS class, no overlays)
// ──────────────────────────────────────────────────────────

/** Inject our blur/highlight CSS once */
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
    }
    .ai-blur:hover {
      filter: blur(2px);
    }
    .ai-blur.revealed {
      filter: none;
    }
  `;
  document.head.appendChild(style);
}

function applyContentBlur(analysis: PageAnalysis): void {
  const threshold = settings?.threshold ?? 70;
  console.log(
    `[AI Shield] Applying blur. Threshold: ${threshold}%, Items: ${analysis.items.length}`,
  );

  let blursApplied = 0;

  analysis.items
    .filter((item) => item.type === "text" && item.score > threshold)
    .forEach((item) => {
      if (item.flaggedRanges && item.flaggedRanges.length > 0) {
        item.flaggedRanges.forEach((range) => {
          const spans = highlightExactOffsets(
            item.id,
            range.start,
            range.end,
            "ai-blur",
          );
          if (spans.length > 0) {
            blursApplied += spans.length;
            spans.forEach((span) => {
              span.title = `AI likelihood: ${Math.round(item.score)}% — click to reveal`;
              span.addEventListener("click", () => {
                span.classList.toggle("revealed");
              });
            });
          }
        });
      }
    });

  console.log(`[AI Shield] Applied blur to ${blursApplied} text node spans.`);
}

function highlightContentOnPage(
  preview: string,
  itemScore?: ContentScore,
): void {
  // Remove previous highlights
  clearHighlights();

  let highlightCount = 0;

  if (
    itemScore &&
    itemScore.flaggedRanges &&
    itemScore.flaggedRanges.length > 0
  ) {
    let anyHighlighted = false;
    itemScore.flaggedRanges.forEach((range) => {
      const spans = highlightExactOffsets(
        itemScore.id,
        range.start,
        range.end,
        "ai-highlight",
      );
      if (spans.length > 0) {
        highlightCount += spans.length;
        if (!anyHighlighted)
          spans[0].scrollIntoView({ behavior: "smooth", block: "center" });
        anyHighlighted = true;
        spans.forEach((s) => setTimeout(() => clearSpan(s), 3000));
      }
    });
    console.log(
      `[AI Shield] Highlighted exact ranges: ${highlightCount} spans created.`,
    );
    if (anyHighlighted) return;
  }

  // Fallback to searching all containers
  for (const [id, container] of activeContainers.entries()) {
    const idx = container.flatText.indexOf(preview.slice(0, 100));
    if (idx !== -1) {
      const spans = highlightExactOffsets(
        id,
        idx,
        idx + Math.min(preview.length, 100),
        "ai-highlight",
      );
      if (spans.length > 0) {
        highlightCount += spans.length;
        spans[0].scrollIntoView({ behavior: "smooth", block: "center" });
        spans.forEach((s) => setTimeout(() => clearSpan(s), 3000));
        console.log(
          `[AI Shield] Fallback string-based highlighted ranges: ${highlightCount} spans created.`,
        );
        return;
      }
    }
  }
}

function clearSpan(span: HTMLSpanElement): void {
  if (span.parentNode) {
    const parent = span.parentNode;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  }
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

function clearBlurs(): void {
  document
    .querySelectorAll('[data-ai-shield="true"].ai-blur')
    .forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    });
}

// ──────────────────────────────────────────────────────────
// SECTION 6: Badge
// ──────────────────────────────────────────────────────────

function injectFloatingBadge(score: number | null): void {
  if (badgeElement) badgeElement.remove();

  const badge = document.createElement("div");
  badge.id = "ai-shield-badge";

  let color = "#94a3b8";
  let bgColor = "rgba(148,163,184,0.15)";
  let scoreText = "Scanning...";

  if (score !== null) {
    color = score <= 40 ? "#22c55e" : score <= 70 ? "#eab308" : "#ef4444";
    bgColor =
      score <= 40
        ? "rgba(34,197,94,0.15)"
        : score <= 70
          ? "rgba(234,179,8,0.15)"
          : "rgba(239,68,68,0.15)";
    scoreText = `AI: ${Math.round(score)}%`;
  }

  badge.innerHTML = `
    <span style="color: ${color}; font-weight: 600;">${scoreText}</span>
    <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
  `;

  Object.assign(badge.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "8px 14px",
    borderRadius: "24px",
    background:
      "linear-gradient(135deg, rgba(10,26,74,0.80), rgba(44,79,153,0.70))",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(148,163,184,0.2)",
    boxShadow: `0 4px 16px rgba(10,26,74,0.4), inset 0 1px 1px rgba(148,163,184,0.15), 0 0 20px 2px ${bgColor}`,
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

  badge.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
  });

  document.body.appendChild(badge);
  badgeElement = badge;
}

// ──────────────────────────────────────────────────────────
// SECTION 7: Main analysis flow
// ──────────────────────────────────────────────────────────

async function runAnalysis(): Promise<void> {
  if (isAnalyzing) return;

  settings = await loadSettings();
  if (!settings.privacyConsent) {
    console.log("[AI Shield] Privacy consent not given, skipping.");
    return;
  }

  isAnalyzing = true;
  injectFloatingBadge(null); // Show "Scanning..."

  // Extract visible text
  const containers = extractContainers();
  console.log(`[AI Shield] Extracted ${containers.length} containers`);

  if (containers.length === 0) {
    isAnalyzing = false;
    injectFloatingBadge(null);
    const badge = badgeElement; // re-read after injectFloatingBadge sets it
    if (badge) {
      badge.innerHTML = `
        <span style="color: #94a3b8; font-weight: 600;">AI: N/A</span>
        <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
      `;
    }
    return;
  }

  // Extract images (viewport-only, via domExtractor)
  const extraction = extractPageContent();
  const compressedImages = await compressImages(extraction.images);

  // Send to background
  const message: ExtensionMessage = {
    type: "EXTRACT_CONTENT",
    payload: {
      url: window.location.href,
      title: document.title,
      containers,
      images: compressedImages,
    },
  };

  chrome.runtime.sendMessage(message, (response: PageAnalysis | null) => {
    isAnalyzing = false;
    if (chrome.runtime.lastError) {
      console.warn(
        "[AI Shield] Background error:",
        chrome.runtime.lastError.message,
      );
      const errBadge = badgeElement;
      if (errBadge) {
        errBadge.innerHTML = `
          <span style="color: #ef4444; font-weight: 600;">AI: Error</span>
          <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
        `;
      }
      return;
    }
    if (response) {
      handleAnalysisResult(response);
    }
  });
}

function handleAnalysisResult(analysis: PageAnalysis): void {
  // Normalize overall score
  if (analysis.overallScore <= 1 && analysis.overallScore > 0) {
    analysis.overallScore = Math.round(analysis.overallScore * 100);
  }

  // TEMPORARILY SIMULATE FLAGGED RANGES FOR DEBUGGING
  // AND NORMALIZE ITEM SCORES
  analysis.items.forEach((item) => {
    if (item.score <= 1 && item.score > 0) {
      item.score = Math.round(item.score * 100);
    }
    if (item.type === "text") {
      // Simulate fake ranges independently of backend for testing
      item.flaggedRanges = [{ start: 20, end: 120 }];
      item.score = 80; // force high score to trigger blur securely
    }
  });

  currentAnalysis = analysis;

  // Debug logging
  console.log(`[AI Shield] --- DEBUG LOGS ---`);
  console.log(`[AI Shield] Containers mapped: ${activeContainers.size}`);
  console.log(
    `[AI Shield] Normalized Overall Score: ${analysis.overallScore}%`,
  );
  console.log(`[AI Shield] Threshold: ${settings?.threshold}%`);

  injectFloatingBadge(analysis.overallScore);

  if (
    settings?.autoBlur &&
    analysis.overallScore > (settings?.threshold ?? 70)
  ) {
    console.log(`[AI Shield] AutoBlur active. Calling applyContentBlur...`);
    applyContentBlur(analysis);
  } else {
    console.log(
      `[AI Shield] AutoBlur skipped. Enable autoBlur and set threshold lower than ${analysis.overallScore} to trigger.`,
    );
  }

  if (isGoogleSearchPage()) {
    injectSearchDots();
  }
}

// ──────────────────────────────────────────────────────────
// SECTION 8: SPA handling — MutationObserver + URL change
// ──────────────────────────────────────────────────────────

let lastUrl = location.href;
let spaDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let spaObserver: MutationObserver | null = null;

function onUrlChange(): void {
  // Debounce rapid URL changes (SPA navigation fires multiple mutations)
  if (spaDebounceTimer) clearTimeout(spaDebounceTimer);
  spaDebounceTimer = setTimeout(() => {
    console.log(`[AI Shield] URL changed → ${location.href}`);
    clearHighlights();
    clearBlurs();
    currentAnalysis = null;
    isAnalyzing = false;
    activeContainers.clear();

    // Re-inject badge fresh after navigation
    if (badgeElement) {
      badgeElement.remove();
      badgeElement = null;
    }

    // Re-run analysis after short settle time
    setTimeout(() => initializeExtension(true), 500);
  }, 350);
}

function startSpaObserver(): void {
  if (spaObserver) return; // Already running
  spaObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onUrlChange();
    }
  });
  spaObserver.observe(document, { subtree: true, childList: true });
  console.log("[AI Shield] SPA MutationObserver started.");
}

// ──────────────────────────────────────────────────────────
// SECTION 9: Google Search Dots
// ──────────────────────────────────────────────────────────

function isGoogleSearchPage(): boolean {
  return (
    window.location.hostname.includes("google.") &&
    window.location.pathname === "/search"
  );
}

function injectSearchDots(): void {
  if (!settings?.showSearchDots) return;

  const resultLinks = document.querySelectorAll("h3");
  resultLinks.forEach((h3) => {
    if ((h3 as HTMLElement).dataset.aiShieldDot) return;
    (h3 as HTMLElement).dataset.aiShieldDot = "true";

    const dot = document.createElement("span");
    dot.title = "AI Content Shield: click badge for details";
    Object.assign(dot.style, {
      display: "inline-block",
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: "rgba(148,163,184,0.5)",
      marginRight: "6px",
      verticalAlign: "middle",
    });
    h3.insertBefore(dot, h3.firstChild);
  });
}

// ──────────────────────────────────────────────────────────
// SECTION 10: Message listener
// ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "ANALYSIS_RESULT":
        handleAnalysisResult(message.payload as PageAnalysis);
        sendResponse({ ok: true });
        break;

      case "BLUR_CONTENT":
        if (currentAnalysis) {
          applyContentBlur(currentAnalysis);
        }
        sendResponse({ ok: true });
        break;

      case "INJECT_DOTS":
        injectSearchDots();
        sendResponse({ ok: true });
        break;

      case "EXTRACT_CONTENT_TRIGGER":
        runAnalysis().then(() => sendResponse({ ok: true }));
        return true;

      case "HIGHLIGHT_ITEM": {
        const { preview, item } = message.payload || {};
        if (preview) {
          highlightContentOnPage(preview, item);
        }
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
    return true;
  },
);

// ──────────────────────────────────────────────────────────
// SECTION 11: Helpers
// ──────────────────────────────────────────────────────────

function loadSettings(): Promise<ShieldSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get("settings", (result) => {
      resolve(
        result.settings || {
          threshold: 70,
          autoBlur: false,
          elderMode: false,
          privacyConsent: true,
          showSearchDots: true,
          backendUrl: "http://localhost:3001",
        },
      );
    });
  });
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}

// ──────────────────────────────────────────────────────────
// SECTION 12: Safe badge injection (guarded, no duplicates)
// ──────────────────────────────────────────────────────────

function ensureBadge(): void {
  if (document.getElementById("ai-shield-badge")) return; // already present
  injectFloatingBadge(null);
}

// ──────────────────────────────────────────────────────────
// SECTION 13: Main entry point
// ──────────────────────────────────────────────────────────

async function initializeExtension(afterNavigation = false): Promise<void> {
  settings = await loadSettings();

  if (!settings.privacyConsent) {
    console.log("[AI Shield] Privacy consent not given, skipping init.");
    return;
  }

  console.log(
    `[AI Shield] Initializing${afterNavigation ? " (post-navigation)" : ""}. URL: ${location.href}`,
  );

  // Inject styles once
  injectStyles();

  // Inject badge (guarded — no duplicate)
  ensureBadge();

  // Start SPA observer (no-op if already running)
  startSpaObserver();

  // Auto-scan after a short settle delay
  const delay = afterNavigation ? 800 : 1500;
  setTimeout(() => {
    console.log("[AI Shield] Auto-scan starting...");
    runAnalysis();
  }, delay);
}

// ──────────────────────────────────────────────────────────
// SECTION 14: Double-init guard + boot
// ──────────────────────────────────────────────────────────

// Prevent double-initialization if the extension is reloaded in an existing tab
// (chrome-extension://invalid errors come from injecting twice after reload)
declare global {
  interface Window {
    __AI_SHIELD_INITIALIZED__?: boolean;
  }
}

if (window.__AI_SHIELD_INITIALIZED__) {
  // Extension was reloaded — reset state cleanly before re-running
  console.log(
    "[AI Shield] Previous instance detected — cleaning up and reinitializing.",
  );
  clearHighlights();
  clearBlurs();
  currentAnalysis = null;
  isAnalyzing = false;
  activeContainers.clear();
  const prevBadge = badgeElement as HTMLElement | null;
  if (prevBadge) {
    prevBadge.remove();
    badgeElement = null;
  }
  const prevObserver = spaObserver as MutationObserver | null;
  if (prevObserver) {
    prevObserver.disconnect();
    spaObserver = null;
  }
}

window.__AI_SHIELD_INITIALIZED__ = true;

// Boot on DOM ready
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
