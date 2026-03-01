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
import {
  detectTextSpans,
  detectImageBatch,
  loadSettings,
  type BackendDetectionResponse,
  type DetectionItemResult,
  type FlagTier,
  type ImageInput,
  type TextChunkInput,
} from "./utils/api";
import type { ExtensionMessage, ShieldSettings } from "./types";

console.log("[AI Shield] Content script initialized.");

type LocalizedPageAnalysis = {
  overallScore: number; // 0..100
  textScore: number; // 0..100
  imageScore: number; // 0..100
  textResults: DetectionItemResult[];
  imageResults: DetectionItemResult[];
};

let currentAnalysis: LocalizedPageAnalysis | null = null;
let settings: ShieldSettings | null = null;
let badgeElement: HTMLElement | null = null;
let isAnalyzing = false;


// ── Text-node map for precise highlighting ──
interface TextNodeEntry {
  node: Text;
  globalStart: number;
  globalEnd: number;
}
let textNodeMap: TextNodeEntry[] = [];
let flatText = "";

// ──────────────────────────────────────────────────────────
// SECTION 1: Visible text extraction
// ──────────────────────────────────────────────────────────

/** Content selectors for specific platforms */
const PLATFORM_SELECTORS: Record<string, string[]> = {
  "linkedin.com": [
    ".feed-shared-update-v2__description",
    ".feed-shared-text",
    ".feed-shared-inline-show-more-text",
  ],
  "facebook.com": [
    'div[role="article"]',
    '[data-ad-preview="message"]',
    ".userContent",
  ],
  "instagram.com": ["article div > span", "._a9zs"],
  "twitter.com": ['[data-testid="tweetText"]', ".tweet-text"],
  "x.com": ['[data-testid="tweetText"]'],
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
  ".nav",
  ".navbar",
  ".sidebar",
  ".advertisement",
  ".ad",
  ".cookie-banner",
  ".cookie-notice",
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

/**
 * Extract visible text from the current page.
 * Uses platform-specific selectors when available,
 * falls back to generic content containers.
 */
function extractVisibleText(): string[] {
  const paragraphs: string[] = [];
  const seen = new Set<string>();

  // Check for Google Docs
  if (window.location.hostname.includes("docs.google.com")) {
    return extractGoogleDocsText();
  }

  // Platform-specific selectors
  const hostname = window.location.hostname;
  let contentSelectors: string[] = [];

  for (const [domain, selectors] of Object.entries(PLATFORM_SELECTORS)) {
    if (hostname.includes(domain)) {
      contentSelectors = selectors;
      break;
    }
  }

  // Fallback to generic content selectors
  if (contentSelectors.length === 0) {
    contentSelectors = [
      "main p",
      "article p",
      '[role="main"] p',
      ".post-content p",
      ".article-body p",
      ".entry-content p",
      '[contenteditable="true"]',
      "main div",
      "article div",
      "section p",
    ];
  }

  for (const selector of contentSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      if (paragraphs.length >= 20) break;
      if (isExcluded(el)) continue;
      if (!isInViewport(el)) continue;

      const text = cleanText(el.textContent || "");
      if (text.length < 50) continue;

      // Deduplicate
      const hash = text.slice(0, 80);
      if (seen.has(hash)) continue;
      seen.add(hash);

      paragraphs.push(text.slice(0, 2000));
    }
  }

  // If we still have very few, try broader selectors (visible only)
  if (paragraphs.length < 2) {
    const broader = document.querySelectorAll("p, div, section, td");
    for (const el of broader) {
      if (paragraphs.length >= 20) break;
      if (isExcluded(el)) continue;
      if (!isInViewport(el)) continue;

      const text = cleanText(el.textContent || "");
      if (text.length < 100 || text.length > 3000) continue;

      const hash = text.slice(0, 80);
      if (seen.has(hash)) continue;
      seen.add(hash);

      paragraphs.push(text.slice(0, 2000));
    }
  }

  return paragraphs;
}

// ──────────────────────────────────────────────────────────

// SECTION 2: Google Docs support
// ──────────────────────────────────────────────────────────

function extractGoogleDocsText(): string[] {
  const paragraphs: string[] = [];

  // Google Docs renders text in .kix-lineview-content spans
  const lineViews = document.querySelectorAll(".kix-lineview-content");

  if (lineViews.length === 0) {
    // Fallback: try the editor div directly
    const editor = document.querySelector(".kix-appview-editor");
    if (editor) {
      const text = cleanText(editor.textContent || "");
      if (text.length > 50) {
        paragraphs.push(text.slice(0, 4000));
      }
    }
    return paragraphs;
  }

  let currentParagraph = "";

  for (const lineView of lineViews) {
    const lineText = cleanText(lineView.textContent || "");
    if (!lineText) {
      // Empty line = paragraph break
      if (currentParagraph.length > 50) {
        paragraphs.push(currentParagraph.slice(0, 2000));
      }
      currentParagraph = "";
      continue;
    }
    currentParagraph += (currentParagraph ? " " : "") + lineText;
  }

  // Push final paragraph
  if (currentParagraph.length > 50) {
    paragraphs.push(currentParagraph.slice(0, 2000));
  }

  return paragraphs;
}

// ──────────────────────────────────────────────────────────
// SECTION 3: Text-node mapping (for highlight/blur)
// ──────────────────────────────────────────────────────────

/**
 * Build a flattened map of all visible text nodes in the content area.
 * Each entry: { node, globalStart, globalEnd }
 */
function mapTextNodes(root?: Element): void {
  textNodeMap = [];
  flatText = "";

  const target =
    root ||
    document.querySelector("main, article, [role='main']") ||
    document.body;

  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
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
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      if (
        parent.closest('[aria-hidden="true"]') ||
        parent.closest("nav") ||
        parent.closest("header")
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
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

  console.log(
    `[AI Shield] Text-node map built: ${textNodeMap.length} nodes, ${flatText.length} chars`,
  );
}

// ──────────────────────────────────────────────────────────
// SECTION 4: Highlight via Range API
// ──────────────────────────────────────────────────────────

/**
 * Find the character offset range for a text snippet in our flat text map.
 */
function findSnippetOffsets(
  snippet: string,
): { start: number; end: number } | null {
  const normSnippet = snippet.replace(/\s+/g, " ").toLowerCase().trim();
  const normFlat = flatText.replace(/\s+/g, " ").toLowerCase();

  if (normSnippet.length < 10) return null;

  const idx = normFlat.indexOf(normSnippet);
  if (idx !== -1) {
    return { start: idx, end: idx + normSnippet.length };
  }

  // Fuzzy: strip all whitespace
  const stripped = normSnippet.replace(/\s+/g, "");
  const flatStripped = flatText.replace(/\s+/g, "").toLowerCase();
  const sIdx = flatStripped.indexOf(stripped);
  if (sIdx === -1) return null;

  // Map stripped offset back to real offset
  let realStart = -1;
  let realEnd = -1;
  let strippedPos = 0;

  for (let i = 0; i < flatText.length; i++) {
    if (!/\s/.test(flatText[i])) {
      if (strippedPos === sIdx) realStart = i;
      if (strippedPos === sIdx + stripped.length - 1) {
        realEnd = i + 1;
        break;
      }
      strippedPos++;
    }
  }

  if (realStart >= 0 && realEnd > realStart) {
    return { start: realStart, end: realEnd };
  }

  return null;
}

/**
 * Create a Range spanning the given character offsets in the text-node map.
 */
function createRangeFromOffsets(start: number, end: number): Range | null {
  if (textNodeMap.length === 0) return null;

  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const entry of textNodeMap) {
    if (!startNode && entry.globalEnd > start) {
      startNode = entry.node;
      startOffset = start - entry.globalStart;
    }
    if (entry.globalEnd >= end) {
      endNode = entry.node;
      endOffset = end - entry.globalStart;
      break;
    }
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(
      startNode,
      Math.max(0, Math.min(startOffset, startNode.length)),
    );
    range.setEnd(endNode, Math.max(0, Math.min(endOffset, endNode.length)));
    return range;
  } catch (e) {
    console.warn("[AI Shield] Range creation failed:", e);
    return null;
  }
}

/**
 * Highlight a text snippet by wrapping it in a <span>.
 */
function highlightRange(
  snippet: string,
  className: string,
): HTMLSpanElement | null {
  const offsets = findSnippetOffsets(snippet);
  if (!offsets) {
    console.warn(
      `[AI Shield] Could not find text: "${snippet.slice(0, 40)}..."`,
    );
    return null;
  }

  const range = createRangeFromOffsets(offsets.start, offsets.end);
  if (!range) return null;

  try {
    const span = document.createElement("span");
    span.className = className;
    span.dataset.aiShield = "true";
    range.surroundContents(span);
    console.log(
      `[AI Shield] Wrapped text with ${className}: "${snippet.slice(0, 30)}..."`,
    );
    return span;
  } catch (e) {
    // surroundContents fails if range spans multiple parent elements
    // Fallback: highlight individual text nodes within the range
    console.warn(
      "[AI Shield] surroundContents failed, using node-level highlighting",
    );
    return highlightRangeFallback(offsets.start, offsets.end, className);
  }
}

/**
 * Fallback: when Range.surroundContents() fails (cross-element range),
 * wrap individual text nodes separately.
 */
function highlightRangeFallback(
  start: number,
  end: number,
  className: string,
): HTMLSpanElement | null {
  let firstSpan: HTMLSpanElement | null = null;

  for (const entry of textNodeMap) {
    if (entry.globalEnd <= start || entry.globalStart >= end) continue;

    const nodeStart = Math.max(0, start - entry.globalStart);
    const nodeEnd = Math.min(entry.node.length, end - entry.globalStart);

    try {
      const range = document.createRange();
      range.setStart(entry.node, nodeStart);
      range.setEnd(entry.node, nodeEnd);

      const span = document.createElement("span");
      span.className = className;
      span.dataset.aiShield = "true";
      range.surroundContents(span);

      if (!firstSpan) firstSpan = span;
    } catch {
      // Skip this node if wrapping fails
    }
  }

  return firstSpan;
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

  // Rebuild text map before blurring
  mapTextNodes();

  analysis.items
    .filter((item) => item.type === "text" && item.score > threshold)
    .forEach((item) => {
      if (!item.preview) return;
      const span = highlightRange(item.preview.slice(0, 120), "ai-blur");
      if (span) {
        span.title = `AI likelihood: ${Math.round(item.score)}% — click to reveal`;
        span.addEventListener("click", () => {
          span.classList.toggle("revealed");
        });
      }
    });
}

function highlightContentOnPage(preview: string): void {
  // Remove previous highlights
  clearHighlights();

  // Rebuild text map
  mapTextNodes();

  const span = highlightRange(preview.slice(0, 120), "ai-highlight");
  if (span) {
    span.scrollIntoView({ behavior: "smooth", block: "center" });

    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (span.parentNode) {
        const parent = span.parentNode;
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    }, 3000);
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
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
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

function renderBadgeEmpty(): void {
  if (!badgeElement) return;
  badgeElement.innerHTML = `
    <span style="color: #94a3b8; font-weight: 600;">AI: N/A</span>
    <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
  `;
}

function renderBadgeError(): void {
  if (!badgeElement) return;
  badgeElement.innerHTML = `
    <span style="color: #ef4444; font-weight: 600;">AI: Error</span>
    <span style="opacity: 0.7; margin-left: 4px; font-size: 12px;">ⓘ</span>
  `;
}

// ──────────────────────────────────────────────────────────
<<<<<<< HEAD
// Text highlighting
// ──────────────────────────────────────────────────────────

function applyTextHighlights(results: DetectionItemResult[]): void {
  clearExistingTextHighlights();

  const flagged = results.filter((r) => r.tier === "medium" || r.tier === "high");
  if (flagged.length === 0) return;

  const candidateElements = Array.from(
    document.querySelectorAll("p, li, blockquote, figcaption, article p, div"),
  ) as HTMLElement[];

  for (const result of flagged) {
    if (!result.text) continue;

    const needle = normalizeText(result.text).slice(0, 120);
    if (!needle) continue;

    for (const el of candidateElements) {
      if ((el.dataset.aiShieldHighlighted || "") === "true") continue;

      const haystack = normalizeText(el.innerText || el.textContent || "");
      if (haystack.length < 20) continue;

      if (haystack.includes(needle)) {
        decorateTextElement(el, result);
        break;
      }
    }
  }
}

function decorateTextElement(el: HTMLElement, result: DetectionItemResult): void {
  el.dataset.aiShieldHighlighted = "true";

  const color = result.tier === "high" ? "#ef4444" : "#eab308";
  const background =
    result.tier === "high"
      ? "rgba(239,68,68,0.08)"
      : "rgba(234,179,8,0.10)";

  el.style.outline = `2px solid ${color}`;
  el.style.outlineOffset = "2px";
  el.style.background = background;
  el.style.borderRadius = "6px";
  el.style.transition = "outline 0.2s ease, background 0.2s ease";
  el.title =
    result.explanation ||
    `AI likelihood: ${Math.round(result.score * 100)}%`;
}

function clearExistingTextHighlights(): void {
  const highlighted = document.querySelectorAll<HTMLElement>(
    '[data-ai-shield-highlighted="true"]',
  );

  highlighted.forEach((el) => {
    el.dataset.aiShieldHighlighted = "";
    el.style.outline = "";
    el.style.outlineOffset = "";
    el.style.background = "";
    el.style.borderRadius = "";
    el.title = "";
  });
}

// ──────────────────────────────────────────────────────────
// Image badges
// ──────────────────────────────────────────────────────────

function applyImageBadges(results: DetectionItemResult[]): void {
  clearExistingImageBadges();

  const images = Array.from(document.querySelectorAll("img")) as HTMLImageElement[];
  const flagged = results.filter((r) => r.tier === "medium" || r.tier === "high");

  flagged.forEach((result) => {
    const match = /^img_(\d+)$/.exec(result.id);
    if (!match) return;

    const index = Number(match[1]) - 1;
    const img = images[index];
    if (!img) return;

    attachBadgeToImage(img, result);
  });
}

function attachBadgeToImage(
  img: HTMLImageElement,
  result: DetectionItemResult,
): void {
  if (img.dataset.aiShieldBadged === "true") return;
  img.dataset.aiShieldBadged = "true";

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";
  wrapper.style.maxWidth = "100%";

  const parent = img.parentNode;
  if (!parent) return;

  parent.insertBefore(wrapper, img);
  wrapper.appendChild(img);

  const badge = document.createElement("div");
  const percent = Math.round(result.score * 100);
  const bg = result.tier === "high" ? "#ef4444" : "#eab308";

  badge.textContent = `${percent}% AI`;
  badge.title =
    result.explanation || `AI likelihood: ${percent}%`;

  Object.assign(badge.style, {
    position: "absolute",
    top: "8px",
    right: "8px",
    zIndex: "10",
    padding: "4px 8px",
    borderRadius: "999px",
    background: bg,
    color: "white",
    fontSize: "12px",
    fontWeight: "700",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    cursor: "help",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  });

  wrapper.appendChild(badge);
}

function clearExistingImageBadges(): void {
  document
    .querySelectorAll<HTMLElement>("[data-ai-shield-image-badge='true']")
    .forEach((el) => el.remove());

  document.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    img.dataset.aiShieldBadged = "";
  });
}

// ──────────────────────────────────────────────────────────
// Blur behavior
// ──────────────────────────────────────────────────────────

function applyContentBlur(analysis: LocalizedPageAnalysis): void {
  const threshold = settings?.threshold ?? 70;

  analysis.textResults
    .filter(
      (item) =>
        item.score * 100 > threshold &&
        (item.tier === "medium" || item.tier === "high"),
    )
    .forEach((item) => {
      const paragraphs = document.querySelectorAll("p, li, blockquote");
      paragraphs.forEach((p) => {
        const text = (p.textContent || "").trim();
        if (
          text.length > 20 &&
          item.text &&
          normalizeText(text).includes(normalizeText(item.text).slice(0, 80))
        ) {
          applyBlurToElement(p as HTMLElement, item.score * 100);
        }
      });
    });
}

function applyBlurToElement(el: HTMLElement, score: number): void {
  if (el.dataset.aiShieldBlurred) return;
  el.dataset.aiShieldBlurred = "true";
=======
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
  const paragraphs = extractVisibleText();
  console.log(`[AI Shield] Extracted ${paragraphs.length} paragraphs`);

  if (paragraphs.length === 0) {
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
      paragraphs,
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
  currentAnalysis = analysis;
  injectFloatingBadge(analysis.overallScore);
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864

  if (
    settings?.autoBlur &&
    analysis.overallScore > (settings?.threshold ?? 70)
  ) {
    applyContentBlur(analysis);
  }

<<<<<<< HEAD
  el.style.filter = "blur(4px) saturate(0.85)";
  el.style.transition = "filter 0.3s ease";

  const label = document.createElement("div");
  label.textContent = `Hidden: likely AI (${Math.round(score)}%) — show anyway`;

  Object.assign(label.style, {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(10,26,74,0.85)",
    backdropFilter: "blur(8px)",
    color: "#94a3b8",
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "12px",
    cursor: "pointer",
    zIndex: "10",
    border: "1px solid rgba(148,163,184,0.2)",
    whiteSpace: "nowrap",
  });

  label.addEventListener("click", () => {
    el.style.filter = "none";
    label.remove();
    el.dataset.aiShieldBlurred = "";
  });

  el.parentNode?.insertBefore(wrapper, el);
  wrapper.appendChild(el);
  wrapper.appendChild(label);
=======
  if (isGoogleSearchPage()) {
    injectSearchDots();
  }
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
}

// ──────────────────────────────────────────────────────────
// SECTION 8: SPA handling — MutationObserver
// ──────────────────────────────────────────────────────────

let lastUrl = location.href;

function reinitialize(): void {
  console.log("[AI Shield] SPA navigation detected, reinitializing...");
  clearHighlights();
  clearBlurs();
  currentAnalysis = null;
  isAnalyzing = false;
  textNodeMap = [];
  flatText = "";

  // Re-inject badge (independent of analysis)
  if (badgeElement) badgeElement.remove();
  badgeElement = null;
  injectFloatingBadge(null);
}

const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    reinitialize();
  }
});

observer.observe(document, { subtree: true, childList: true });

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
<<<<<<< HEAD

=======
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
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
<<<<<<< HEAD
// Utility
// ──────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// ──────────────────────────────────────────────────────────
// Message handling
=======
// SECTION 10: Message listener
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
// ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    switch (message.type) {
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
<<<<<<< HEAD
        init().then(() => sendResponse({ ok: true }));
=======
        runAnalysis().then(() => sendResponse({ ok: true }));
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
        return true;

      case "HIGHLIGHT_ITEM": {
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
    return true;
  },
);

// ──────────────────────────────────────────────────────────

// SECTION 11: Initialization
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

// Inject styles immediately
injectStyles();

// Inject badge on load (independent of analysis)
async function initBadge(): Promise<void> {
  settings = await loadSettings();
  if (settings.privacyConsent) {
    injectFloatingBadge(null);
    // Auto-analyze on first load
    setTimeout(() => runAnalysis(), 1500);
  }
}

if (document.readyState === "complete") {
  initBadge();
} else {
  window.addEventListener("load", () => initBadge());
}
