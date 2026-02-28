// ──────────────────────────────────────────────────────────
// Content Script — AI Content Shield
// ──────────────────────────────────────────────────────────
// Injected into every HTTP(S) page. Extracts visible text and images,
// sends to background for analysis, and applies UI changes (blur, dots).
//
// Runs in the page's isolated world. Communicates with background
// via chrome.runtime.sendMessage.

import { extractPageContent } from "./utils/domExtractor";
import { compressImages } from "./utils/imageCompressor";
import type {
  ExtensionMessage,
  PageAnalysis,
  ContentScore,
  ShieldSettings,
} from "./types";

console.log("[AI Shield] Content script initialized. Ready to scan.");

// ── State ──
let currentAnalysis: PageAnalysis | null = null;
let settings: ShieldSettings | null = null;
let badgeElement: HTMLElement | null = null;
let hasMeaningfulContent = false;
let isAnalyzing = false;

// ── Initialization ──
// Wait a brief moment after page load for dynamic content to settle
const INIT_DELAY_MS = 1500;
const DEBOUNCE_MS = 2000;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Replace observer with setInterval for initial scan
let initInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Main initialization — runs after page load + delay.
 * Extracts content, sends to background for analysis.
 */
async function init(): Promise<void> {
  // Load user settings
  settings = await loadSettings();

  // Check privacy consent — don't analyze if user hasn't consented
  if (!settings.privacyConsent) {
    console.log("[AI Shield] Privacy consent not given, skipping analysis.");
    return;
  }

  // Inject initial "Analyzing..." badge
  if (!badgeElement) {
    injectFloatingBadge(null);
  }

  isAnalyzing = true;

  // Extract page content
  const extraction = extractPageContent();

  // Skip if page has very little content
  if (extraction.paragraphs.length === 0 && extraction.images.length === 0) {
    console.log("[AI Shield] No meaningful content found on page.");
    hasMeaningfulContent = false;
    isAnalyzing = false;
    if (badgeElement) {
      badgeElement.innerHTML = `
        <span style="color: #94a3b8; font-weight: 600;">AI: N/A (Short text)</span>
        <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
      `;
    }
    return;
  }

  hasMeaningfulContent = true;

  // Compress images before sending (limit bandwidth)
  const compressedImages = await compressImages(extraction.images);

  // Send to background for analysis
  const message: ExtensionMessage = {
    type: "EXTRACT_CONTENT",
    payload: {
      ...extraction,
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
      if (badgeElement) {
        badgeElement.innerHTML = `
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

/**
 * Handle analysis results from the background service worker.
 * Updates the floating badge and optionally blurs content.
 */
function handleAnalysisResult(analysis: PageAnalysis): void {
  currentAnalysis = analysis;

  // Inject or update the floating badge
  injectFloatingBadge(analysis.overallScore);

  // Apply blur if auto-blur is enabled and score exceeds threshold
  if (
    settings?.autoBlur &&
    analysis.overallScore > (settings?.threshold ?? 70)
  ) {
    applyContentBlur(analysis);
  }

  // If we're on Google search results, inject colored dots
  if (isGoogleSearchPage()) {
    injectSearchDots();
  }
}

// ──────────────────────────────────────────────────────────
// Floating Badge (injected into page DOM)
// ──────────────────────────────────────────────────────────

function injectFloatingBadge(score: number | null): void {
  // Remove existing badge if present
  if (badgeElement) badgeElement.remove();

  const badge = document.createElement("div");
  badge.id = "ai-shield-badge";

  // Determine color based on score
  let color = "#94a3b8"; // Default parsing gray
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

  // Liquid Glass styling — dark blue glassmorphism
  Object.assign(badge.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "8px 14px",
    borderRadius: "24px",
    background: `linear-gradient(135deg, rgba(10,26,74,0.80), rgba(44,79,153,0.70))`,
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: `1px solid rgba(148,163,184,0.2)`,
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

  // Hover: slight expand
  badge.addEventListener("mouseenter", () => {
    badge.style.transform = "scale(1.08)";
    badge.style.boxShadow = `0 6px 24px rgba(10,26,74,0.5), inset 0 1px 1px rgba(148,163,184,0.2), 0 0 30px 4px ${bgColor}`;
  });
  badge.addEventListener("mouseleave", () => {
    badge.style.transform = "scale(1)";
    badge.style.boxShadow = `0 4px 16px rgba(10,26,74,0.4), inset 0 1px 1px rgba(148,163,184,0.15), 0 0 20px 2px ${bgColor}`;
  });

  // Click: open side panel
  badge.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
  });

  document.body.appendChild(badge);
  badgeElement = badge;
}

// ──────────────────────────────────────────────────────────
// Content Blur
// ──────────────────────────────────────────────────────────

function findRangeForSnippet(snippet: string): Range | null {
  const normSnippet = snippet.replace(/\s+/g, "").toLowerCase();
  if (normSnippet.length < 10) return null;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
  );
  let node;
  let fullText = "";
  const nodes: { node: Text; start: number; end: number }[] = [];

  while ((node = walker.nextNode() as Text)) {
    const parent = node.parentElement;
    if (parent) {
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
      // skip completely hidden elements
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") continue;
    }

    const text = (node.nodeValue || "").replace(/\s+/g, "").toLowerCase();
    if (!text) continue;

    nodes.push({
      node,
      start: fullText.length,
      end: fullText.length + text.length,
    });
    fullText += text;
  }

  const matchIdx = fullText.indexOf(normSnippet);
  if (matchIdx === -1) return null;

  const matchEnd = matchIdx + normSnippet.length;
  const overlapping = nodes.filter(
    (n) => n.end > matchIdx && n.start < matchEnd,
  );

  if (overlapping.length === 0) return null;

  const range = document.createRange();
  range.setStartBefore(overlapping[0].node);
  range.setEndAfter(overlapping[overlapping.length - 1].node);
  return range;
}

function applyContentBlur(analysis: PageAnalysis): void {
  const threshold = settings?.threshold ?? 70;

  analysis.items
    .filter((item) => item.type === "text" && item.score > threshold)
    .forEach((item) => {
      if (!item.preview) return;
      const snippet = item.preview.slice(0, 80);
      const range = findRangeForSnippet(snippet);
      if (range) {
        applyOverlayBlur(range, item.score);
      }
    });
}

function applyOverlayBlur(range: Range, score: number): void {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const overlay = document.createElement("div");
  overlay.className = "ai-shield-blur-overlay";
  overlay.style.position = "absolute";
  overlay.style.top = `${rect.top + window.scrollY - 4}px`;
  overlay.style.left = `${rect.left + window.scrollX - 4}px`;
  overlay.style.width = `${rect.width + 8}px`;
  overlay.style.height = `${rect.height + 8}px`;
  overlay.style.backdropFilter = "blur(6px) saturate(0.85)";
  overlay.style.backgroundColor = "rgba(10,26,74,0.15)";
  overlay.style.zIndex = "2147483646";
  overlay.style.borderRadius = "6px";
  overlay.style.border = "1px solid rgba(148,163,184,0.2)";
  overlay.style.transition = "opacity 0.3s ease";

  const label = document.createElement("div");
  label.textContent = `Hidden: likely AI (${Math.round(score)}%) — click to show`;
  Object.assign(label.style, {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(10,26,74,0.95)",
    color: "#e2e8f0",
    padding: "8px 16px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "500",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    border: "1px solid rgba(148,163,184,0.3)",
  });

  overlay.appendChild(label);
  document.body.appendChild(overlay);

  // Click anywhere on the overlay (or label) to reveal
  overlay.addEventListener("click", () => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 300);
  });
}

// ──────────────────────────────────────────────────────────
// Highlight content on page (triggered from SidePanel)
// ──────────────────────────────────────────────────────────

function highlightContentOnPage(preview: string): void {
  // Remove existing highlights
  document.querySelectorAll(".ai-shield-highlight-overlay").forEach((el) => {
    el.remove();
  });

  const snippet = preview.slice(0, 80);
  const range = findRangeForSnippet(snippet);
  if (!range) return;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const overlay = document.createElement("div");
  overlay.className = "ai-shield-highlight-overlay";
  overlay.style.position = "absolute";
  overlay.style.top = `${rect.top + window.scrollY - 6}px`;
  overlay.style.left = `${rect.left + window.scrollX - 6}px`;
  overlay.style.width = `${rect.width + 12}px`;
  overlay.style.height = `${rect.height + 12}px`;
  overlay.style.border = "3px solid rgba(99, 102, 241, 0.9)";
  overlay.style.backgroundColor = "rgba(99, 102, 241, 0.2)";
  overlay.style.borderRadius = "6px";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "2147483647";
  overlay.style.transition = "opacity 0.3s ease";

  document.body.appendChild(overlay);

  // Scroll into view comfortably
  const elementTop = rect.top + window.scrollY;
  window.scrollTo({
    top: elementTop - window.innerHeight / 2 + rect.height / 2,
    behavior: "smooth",
  });

  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 300);
  }, 3000);
}

// ──────────────────────────────────────────────────────────
// Google Search Dots
// ──────────────────────────────────────────────────────────

function isGoogleSearchPage(): boolean {
  return (
    window.location.hostname.includes("google.") &&
    window.location.pathname === "/search"
  );
}

/**
 * Inject tiny colored dots next to Google search result titles.
 * This runs on-demand when the user has search dot display enabled.
 * For MVP: shows a neutral dot; real implementation would analyze each result.
 */
function injectSearchDots(): void {
  if (!settings?.showSearchDots) return;

  // Google search result title selectors
  const resultLinks = document.querySelectorAll("h3");

  resultLinks.forEach((h3) => {
    // Skip if dot already injected
    if ((h3 as HTMLElement).dataset.aiShieldDot) return;
    (h3 as HTMLElement).dataset.aiShieldDot = "true";

    const dot = document.createElement("span");
    dot.title = "AI Content Shield: click badge for details";

    // For MVP, show a neutral gray dot (real: would be colored per-result)
    Object.assign(dot.style, {
      display: "inline-block",
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: "rgba(148,163,184,0.5)",
      marginRight: "6px",
      verticalAlign: "middle",
      flexShrink: "0",
    });

    h3.insertBefore(dot, h3.firstChild);
  });
}

// ── Listen for messages from background / popup ──
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
        // Background requesting a fresh extraction
        init().then(() => sendResponse({ ok: true }));
        return true;

      case "HIGHLIGHT_ITEM": {
        // SidePanel requesting we scroll to and highlight a content item
        const { preview } = message.payload || {};
        if (preview) {
          highlightContentOnPage(preview);
        }
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
    return true; // keep channel open for async
  },
);

// ── SPA Support: Listen for URL changes and content loading ──
let lastUrl = window.location.href;

setInterval(() => {
  // Check for URL changes
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    console.log("[AI Shield] URL changed, re-initializing...");
    // Clear old state
    if (badgeElement) badgeElement.remove();
    badgeElement = null;
    currentAnalysis = null;
    hasMeaningfulContent = false;
    isAnalyzing = false;
    // Re-run init with a delay
    setTimeout(init, Math.max(INIT_DELAY_MS, 1500));
  }
  // Retry extraction if the page loaded slowly and we previously found no content
  else if (!hasMeaningfulContent && !isAnalyzing && currentAnalysis === null) {
    // Quick heuristic check to see if DOM has populated
    const textNodes = document.querySelectorAll("p, article, div");
    if (textNodes.length > 10) {
      console.log(
        "[AI Shield] Late-loading content detected. Retrying scan...",
      );
      isAnalyzing = true; // prevent overlapping retries
      init();
    }
  }
}, 1500); // Check every 1.5 seconds

// ── Load settings helper ──
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

// ── Start with a delay after page load ──
if (document.readyState === "complete") {
  setTimeout(init, INIT_DELAY_MS);
} else {
  window.addEventListener("load", () => setTimeout(init, INIT_DELAY_MS));
}
