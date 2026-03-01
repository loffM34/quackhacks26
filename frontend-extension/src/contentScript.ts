// ──────────────────────────────────────────────────────────
// Content Script — AI Content Shield (v2 Rewrite)
// ──────────────────────────────────────────────────────────
// Design:
//   1. Viewport-first extraction with ±800px buffer
//   2. Readable block elements only (p, li, blockquote, pre, h1-h3)
//   3. Fingerprint deduplication — no duplicate analysis
//   4. Coarse block-level blur (not per-character-range)
//   5. SPA detection via history hooks + MutationObserver
//   6. Single init with double-init guard

import type {
  ExtensionMessage,
  ShieldSettings,
  PageAnalysis,
  ContentScore,
} from "./types";

// ── Constants ──
const DEBUG = true;
const DEBUG_VISUAL = true; // outline extracted blocks; color-coded after scoring
const MAX_BLOCKS = 30;
const MAX_CHARS = 2500;
const MIN_CHARS = 120;
const MIN_WORDS = 80;
const VIEWPORT_BUFFER = 800; // px above/below viewport
const SCAN_DEBOUNCE_MS = 1200;
const NAV_DEBOUNCE_MS = 800;
const MAX_IMAGES = 5;
const MIN_IMAGE_DIM = 100; // px — skip icons/avatars
const IMAGE_MAX_SIDE = 512; // px — resize before sending
const IMAGE_QUALITY = 0.7; // JPEG compression

// Known social/platform domains — always use platform extractor, never fall back to generic
const PLATFORM_DOMAINS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "reddit.com",
];

// Readable block-level tags we care about
const READABLE_TAGS = new Set([
  "P",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "TD",
  "DD",
  "FIGCAPTION",
]);

// Elements to skip entirely
const SKIP_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "button",
  "input",
  "textarea",
  "select",
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="tooltip"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="toolbar"]',
  ".cookie-banner",
  ".sr-only",
  // Wikipedia boilerplate
  ".navbox",
  ".infobox",
  ".sidebar",
  ".mw-editsection",
  ".reference",
  ".reflist",
  ".refbegin",
  "#coordinates",
  ".catlinks",
  ".mw-indicators",
  // Social media chrome
  '[data-testid="socialContext"]',
  '[data-testid="placementTracking"]',
].join(",");

// ── State ──
let currentAnalysis: PageAnalysis | null = null;
let settings: ShieldSettings | null = null;
let badgeEl: HTMLElement | null = null;
let isAnalyzing = false;
let lastUrl = location.href;

// Fingerprint tracking
const scannedFingerprints = new Set<string>();
let blockIdCounter = 0;

// Timers & observers
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let navTimer: ReturnType<typeof setTimeout> | null = null;
let contentObserver: MutationObserver | null = null;
let badgeGuardInterval: ReturnType<typeof setInterval> | null = null;

// Block-to-element map for blur and highlight
const blockElements = new Map<string, Element>();

// Track images already sent so we don't resend on scroll
const scannedImageSrcs = new Set<string>();

// ──────────────────────────────────────────────────────────
// § UTILITIES
// ──────────────────────────────────────────────────────────

function dbg(msg: string, ...args: unknown[]): void {
  if (DEBUG) console.log(`[Flare] ${msg}`, ...args);
}

function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function fingerprint(text: string): string {
  const sample = text.slice(0, 200);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
  }
  return `fp_${hash}`;
}

async function safeSend<T = any>(msg: ExtensionMessage): Promise<T | null> {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.id) {
      dbg("Extension context invalidated.");
      return resolve(null);
    }
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          dbg("Message error:", chrome.runtime.lastError.message);
          return resolve(null);
        }
        resolve(response as T);
      });
    } catch {
      resolve(null);
    }
  });
}

async function loadSettings(): Promise<ShieldSettings> {
  const defaults: ShieldSettings = {
    threshold: 70,
    autoBlur: false,
    elderMode: false,
    privacyConsent: true,
    showSearchDots: true,
    backendUrl: "http://localhost:3001",
  };
  if (!chrome?.runtime?.id) {
    return defaults;
  }

  try {
    const result = await chrome.storage.local.get("settings");
    return { ...defaults, ...(result.settings || {}) };
  } catch (err) {
    console.warn("[Flare] Settings load error:", err);
    return defaults;
  }
}

function isInExpandedViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const top = -VIEWPORT_BUFFER;
  const bottom = window.innerHeight + VIEWPORT_BUFFER;
  return rect.bottom >= top && rect.top <= bottom;
}

function isSkipped(el: Element): boolean {
  try {
    if (el.matches(SKIP_SELECTORS)) return true;
    if (el.closest(SKIP_SELECTORS)) return true;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
  } catch {
    // ignore
  }
  return false;
}

// ──────────────────────────────────────────────────────────
// § EXTRACTION
// ──────────────────────────────────────────────────────────

interface ExtractedBlock {
  id: string;
  text: string;
  element: Element;
}

/**
 * Main extraction: find readable blocks in the viewport (±buffer).
 * Returns only NEW blocks not yet fingerprinted.
 */
function extractBlocks(): ExtractedBlock[] {
  const hostname = window.location.hostname;

  // Platform-specific extraction
  if (hostname.includes("docs.google.com")) return extractGoogleDocs();
  if (hostname.includes("wikipedia.org")) return extractWikipedia();

  // Social media platforms — always use platform extractor, never fall back to generic
  if (PLATFORM_DOMAINS.some((d) => hostname.includes(d))) {
    return extractPlatformContainers(hostname);
  }

  // Generic: find all readable block elements
  return extractGenericBlocks();
}

function extractGenericBlocks(): ExtractedBlock[] {
  const results: ExtractedBlock[] = [];

  // Strategy: query all readable tags, filter by viewport + content quality
  const tagSelector = Array.from(READABLE_TAGS)
    .map((t) => t.toLowerCase())
    .join(",");
  // Also grab role="article" containers
  const candidates = document.querySelectorAll(
    `${tagSelector}, [role="article"]`,
  );

  for (const el of candidates) {
    if (results.length >= MAX_BLOCKS) break;
    if (isSkipped(el)) continue;
    if (!isInExpandedViewport(el)) continue;

    const text = cleanText(
      (el as HTMLElement).innerText || el.textContent || "",
    );
    if (text.length < MIN_CHARS || wordCount(text) < MIN_WORDS) continue;

    const fp = fingerprint(text);
    if (scannedFingerprints.has(fp)) continue;
    scannedFingerprints.add(fp);

    const id = `b-${blockIdCounter++}`;
    blockElements.set(id, el);
    results.push({ id, text: text.slice(0, MAX_CHARS), element: el });
  }

  // If we got very few blocks from individual tags, try larger containers
  if (results.length < 3) {
    const containers = document.querySelectorAll(
      "article, main, [role='main'], .post, .entry-content, .article-body",
    );
    for (const container of containers) {
      if (results.length >= MAX_BLOCKS) break;
      if (isSkipped(container)) continue;

      const text = cleanText((container as HTMLElement).innerText || "");
      if (text.length < MIN_CHARS || wordCount(text) < MIN_WORDS) continue;

      const fp = fingerprint(text);
      if (scannedFingerprints.has(fp)) continue;
      scannedFingerprints.add(fp);

      const id = `b-${blockIdCounter++}`;
      blockElements.set(id, container);
      results.push({ id, text: text.slice(0, MAX_CHARS), element: container });
    }
  }

  return results;
}

function extractWikipedia(): ExtractedBlock[] {
  const results: ExtractedBlock[] = [];

  // Prefer the main content area paragraphs
  const paragraphs = document.querySelectorAll(
    "#mw-content-text .mw-parser-output > p",
  );

  for (const el of paragraphs) {
    if (results.length >= MAX_BLOCKS) break;
    if (isSkipped(el)) continue;

    const text = cleanText((el as HTMLElement).innerText || "");
    if (text.length < MIN_CHARS) continue;

    const fp = fingerprint(text);
    if (scannedFingerprints.has(fp)) continue;
    scannedFingerprints.add(fp);

    const id = `wiki-${blockIdCounter++}`;
    blockElements.set(id, el);
    results.push({ id, text: text.slice(0, MAX_CHARS), element: el });
  }

  return results;
}

function extractGoogleDocs(): ExtractedBlock[] {
  const results: ExtractedBlock[] = [];

  // Modern Google Docs renders each paragraph as a .kix-paragraphrenderer element.
  // innerText on the container is unreliable because text spans are absolutely
  // positioned — but innerText on individual paragraph nodes works correctly.
  const paragraphs = document.querySelectorAll(".kix-paragraphrenderer");
  dbg(
    `Google Docs: found ${paragraphs.length} .kix-paragraphrenderer elements`,
  );
  if (paragraphs.length > 0) {
    const CHUNK_SIZE = 1500;
    let buffer = "";
    let lastEl: Element = paragraphs[paragraphs.length - 1];

    const flush = (el: Element) => {
      if (buffer.length < MIN_CHARS) return;
      const fp = fingerprint(buffer);
      if (scannedFingerprints.has(fp)) return;
      scannedFingerprints.add(fp);
      const id = `docs-${blockIdCounter++}`;
      blockElements.set(id, el);
      results.push({ id, text: buffer.slice(0, MAX_CHARS), element: el });
      buffer = "";
    };

    for (const p of paragraphs) {
      const text = cleanText(
        (p as HTMLElement).innerText || p.textContent || "",
      );
      if (!text) continue;
      lastEl = p;
      buffer += (buffer ? " " : "") + text;
      if (buffer.length >= CHUNK_SIZE) flush(p);
    }
    flush(lastEl);

    if (results.length > 0) return results;
  }

  // Fallback for older / unsupported Google Docs layouts
  const fallbackSelectors = [
    ".docs-editor-container",
    '[role="textbox"][contenteditable="true"]',
    ".kix-appview-editor",
  ];
  for (const sel of fallbackSelectors) {
    const editor = document.querySelector(sel);
    if (!editor) continue;
    const text = cleanText((editor as HTMLElement).innerText || "");
    if (text.length < MIN_CHARS) continue;
    const fp = fingerprint(text);
    if (scannedFingerprints.has(fp)) continue;
    scannedFingerprints.add(fp);
    const id = `docs-${blockIdCounter++}`;
    blockElements.set(id, editor);
    results.push({ id, text: text.slice(0, MAX_CHARS), element: editor });
    break;
  }

  return results;
}

function extractPlatformContainers(hostname: string): ExtractedBlock[] {
  const results: ExtractedBlock[] = [];

  const platformMap: Record<string, string[]> = {
    "linkedin.com": [
      ".feed-shared-update-v2__description",
      ".feed-shared-text__text-view",
      ".feed-shared-update-v2",
    ],
    "facebook.com": ['div[role="article"]'],
    "instagram.com": ["article"],
    "twitter.com": ['[data-testid="tweetText"]'],
    "x.com": ['[data-testid="tweetText"]'],
    "reddit.com": ['[data-testid="post-container"]', ".Post", "shreddit-post"],
  };

  let selectors: string[] = [];
  for (const [domain, sels] of Object.entries(platformMap)) {
    if (hostname.includes(domain)) {
      selectors = sels;
      break;
    }
  }
  if (selectors.length === 0) return results;

  for (const sel of selectors) {
    const elements = document.querySelectorAll(sel);
    for (const el of elements) {
      if (results.length >= MAX_BLOCKS) break;
      if (isSkipped(el)) continue;
      if (!isInExpandedViewport(el)) continue;

      const text = cleanText((el as HTMLElement).innerText || "");
      if (text.length < 30) continue; // Lower threshold for platforms (images may carry the content)

      const fp = fingerprint(text);
      if (scannedFingerprints.has(fp)) continue;
      scannedFingerprints.add(fp);

      const id = `p-${blockIdCounter++}`;
      blockElements.set(id, el);
      results.push({ id, text: text.slice(0, MAX_CHARS), element: el });
    }
    if (results.length > 0) break; // First matching selector wins
  }

  return results;
}

// ──────────────────────────────────────────────────────────
// § IMAGE EXTRACTION
// ──────────────────────────────────────────────────────────

/**
 * Extract visible, content-relevant images from the page.
 * Filters out icons, decorative images, tracking pixels, and nav/header images.
 * Compresses each to max 512px JPEG via a hidden canvas.
 * Returns at most MAX_IMAGES base64 strings.
 */
async function extractImages(): Promise<string[]> {
  const imgs = document.querySelectorAll("img");
  const candidates: HTMLImageElement[] = [];

  for (const img of imgs) {
    if (candidates.length >= MAX_IMAGES * 2) break; // pre-filter pool

    const htmlImg = img as HTMLImageElement;
    const src = htmlImg.currentSrc || htmlImg.src || "";

    // Skip empty, data-URI placeholders, SVG, and already-analyzed
    if (
      !src ||
      src.startsWith("data:image/svg") ||
      src.startsWith("data:image/gif")
    )
      continue;
    if (scannedImageSrcs.has(src)) continue;

    // Skip tiny images (icons, avatars, tracking pixels)
    const nat = { w: htmlImg.naturalWidth, h: htmlImg.naturalHeight };
    if (nat.w > 0 && nat.w < MIN_IMAGE_DIM) continue;
    if (nat.h > 0 && nat.h < MIN_IMAGE_DIM) continue;

    // Skip rendered size if available
    const rect = htmlImg.getBoundingClientRect();
    if (rect.width < MIN_IMAGE_DIM || rect.height < MIN_IMAGE_DIM) continue;

    // Skip decorative / non-content images
    if (htmlImg.getAttribute("role") === "presentation") continue;
    if (htmlImg.getAttribute("aria-hidden") === "true") continue;
    if (
      htmlImg.closest(
        "nav, header, footer, button, [role='navigation'], [role='banner']",
      )
    )
      continue;

    // Must be in expanded viewport
    if (!isInExpandedViewport(htmlImg)) continue;

    candidates.push(htmlImg);
  }

  // Sort by area descending — prefer larger content images
  candidates.sort((a, b) => {
    const aArea = a.naturalWidth * a.naturalHeight;
    const bArea = b.naturalWidth * b.naturalHeight;
    return bArea - aArea;
  });

  const results: string[] = [];
  let imgIndex = 0;

  for (const img of candidates.slice(0, MAX_IMAGES)) {
    const src = img.currentSrc || img.src || "";
    imgIndex++;
    scannedImageSrcs.add(src);
    blockElements.set(`img_${imgIndex}`, img);

    try {
      const b64 = await compressImage(img);
      if (b64) {
        results.push(b64);
        continue;
      }
    } catch {
      // Canvas tainted by CORS — fall through to URL fallback
    }

    // Fallback: send the URL so the background (with full network access) can fetch it
    if (src && !src.startsWith("data:")) {
      results.push(`url:${src}`);
      dbg(
        `Image ${imgIndex} CORS-blocked, sending URL fallback: ${src.slice(0, 80)}...`,
      );
    } else {
      imgIndex--; // undo increment if we can't use this image at all
      blockElements.delete(`img_${imgIndex + 1}`);
    }
  }

  dbg(
    `Extracted ${results.length} images (from ${candidates.length} candidates).`,
  );
  return results;
}

/**
 * Compress an image to a JPEG base64 string via a hidden canvas.
 * Resizes so the longest side is at most IMAGE_MAX_SIDE px.
 */
function compressImage(img: HTMLImageElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);

      let { naturalWidth: w, naturalHeight: h } = img;
      if (w === 0 || h === 0) return resolve(null);

      // Resize if too large
      if (w > IMAGE_MAX_SIDE || h > IMAGE_MAX_SIDE) {
        const scale = IMAGE_MAX_SIDE / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", IMAGE_QUALITY);
      resolve(dataUrl);
    } catch {
      resolve(null);
    }
  });
}

// ──────────────────────────────────────────────────────────
// § ANALYSIS
// ──────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  if (isAnalyzing) return;

  settings = await loadSettings();
  if (!settings.privacyConsent) {
    dbg("Privacy consent not given, skipping.");
    return;
  }

  const blocks = extractBlocks();
  const images = await extractImages();
  dbg(
    `Extracted ${blocks.length} text blocks, ${images.length} images (${scannedFingerprints.size} fingerprints).`,
  );

  if (blocks.length === 0 && images.length === 0) {
    ensureBadge();
    if (!currentAnalysis) {
      updateBadgeText("No content to analyze");
    }
    return;
  }

  isAnalyzing = true;
  updateBadgeText("Scanning...");

  const containers = blocks.map((b) => ({ id: b.id, text: b.text }));

  // ── DEBUG: log what's being sent ──
  if (DEBUG) {
    console.groupCollapsed(
      `[Flare] Sending ${containers.length} blocks to backend`,
    );
    containers.forEach((c, i) => {
      const words = c.text.split(/\s+/).filter(Boolean).length;
      console.log(
        `Block ${i + 1} [${c.id}] (${words} words, ${c.text.length} chars):\n"${c.text}"`,
      );
    });
    console.groupEnd();
  }

  // ── DEBUG: outline blocks being analyzed ──
  if (DEBUG_VISUAL) {
    blocks.forEach((b) => {
      (b.element as HTMLElement).style.outline =
        "2px dashed rgba(99,102,241,0.6)";
      (b.element as HTMLElement).dataset.aiShieldDebug = b.id;
    });
  }

  if (DEBUG && images.length > 0) {
    dbg(
      `Sending ${images.length} images to backend (${images.reduce((s, i) => s + i.length, 0)} total chars).`,
    );
  }

  const response = await safeSend<PageAnalysis>({
    type: "EXTRACT_CONTENT",
    payload: {
      url: window.location.href,
      title: document.title,
      containers,
      images,
    },
  });

  isAnalyzing = false;

  if (!response) {
    dbg("No response from background.");
    updateBadgeText("Error");
    return;
  }

  if (response.items.length === 0) {
    dbg("No items scored — model was not called (all blocks too short).");
    // Keep showing the previous valid analysis if we have one — don't overwrite
    // a good score just because a subsequent scan found nothing scoreable.
    if (!currentAnalysis) {
      updateBadgeText("Not enough text");
    }
    return;
  }

  currentAnalysis = response;
  updateBadgeScore(response.overallScore);
  dbg(
    `Analysis: overall=${response.overallScore}%, items=${response.items.length}`,
  );

  // ── DEBUG: log score breakdown + color-code blocks ──
  if (DEBUG) {
    console.groupCollapsed(
      `[Flare] Scores (overall: ${response.overallScore}%)`,
    );
    const rows = response.items.map((item) => {
      const score = Math.round(item.score);
      return {
        id: item.id,
        score: `${score}%`,
        tier: item.tier,
        preview: item.preview?.slice(0, 80),
      };
    });
    console.table(rows);
    console.groupEnd();
  }
  if (DEBUG_VISUAL) {
    response.items.forEach((item) => {
      const score = Math.round(item.score);
      const color =
        score <= 40
          ? "rgba(34,197,94,0.6)"
          : score <= 70
            ? "rgba(234,179,8,0.7)"
            : "rgba(239,68,68,0.7)";
      const el = blockElements.get(item.id) as HTMLElement | undefined;
      if (el) {
        el.style.outline = `2px solid ${color}`;
        el.title = `[AI Shield Debug] score: ${score}% | id: ${item.id}`;
      }
    });
  }

  // Auto-blur if enabled
  if (settings.autoBlur) {
    applyCoarseBlur(response);
  }
}

function debouncedScan(): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => runScan(), SCAN_DEBOUNCE_MS);
}

// ──────────────────────────────────────────────────────────
// § COARSE BLOCK-LEVEL BLUR
// ──────────────────────────────────────────────────────────

function applyCoarseBlur(analysis: PageAnalysis): void {
  const threshold = settings?.threshold ?? 70;
  let blurred = 0;

  for (const item of analysis.items) {
    const score = Math.round(item.score);
    if (score <= threshold) continue;

    const el = blockElements.get(item.id) as HTMLElement | undefined;
    if (!el) continue;

    el.classList.add("ai-shield-blur");
    el.title = `AI likelihood: ${score}% — click to reveal`;
    el.style.cursor = "pointer";

    // One-time click listener to reveal
    const reveal = () => {
      el.classList.remove("ai-shield-blur");
      el.classList.add("ai-shield-revealed");
      el.title = "";
      el.style.cursor = "";
      el.removeEventListener("click", reveal);
    };
    el.addEventListener("click", reveal);
    blurred++;
  }

  dbg(`Blurred ${blurred} blocks above ${threshold}% threshold.`);
}

function clearBlur(): void {
  document
    .querySelectorAll(".ai-shield-blur, .ai-shield-revealed")
    .forEach((el) => {
      el.classList.remove("ai-shield-blur", "ai-shield-revealed");
      (el as HTMLElement).title = "";
      (el as HTMLElement).style.cursor = "";
    });
}

// ──────────────────────────────────────────────────────────
// § HIGHLIGHT (side panel → content script)
// ──────────────────────────────────────────────────────────

function highlightItem(itemId: string, preview?: string): void {
  // Remove previous highlights
  document.querySelectorAll(".ai-shield-highlight").forEach((el) => {
    el.classList.remove("ai-shield-highlight");
  });

  // Try by block ID first
  const el = blockElements.get(itemId) as HTMLElement | undefined;
  if (el) {
    el.classList.add("ai-shield-highlight");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el.classList.remove("ai-shield-highlight"), 4000);
    return;
  }

  // Fallback: search by preview text
  if (!preview) return;
  const searchText = preview.slice(0, 80);
  for (const [, blockEl] of blockElements) {
    const htmlEl = blockEl as HTMLElement;
    if (htmlEl.innerText?.includes(searchText)) {
      htmlEl.classList.add("ai-shield-highlight");
      htmlEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => htmlEl.classList.remove("ai-shield-highlight"), 4000);
      return;
    }
  }
}

// ──────────────────────────────────────────────────────────
// § BADGE
// ──────────────────────────────────────────────────────────

function ensureBadge(): void {
  if (document.getElementById("flare-badge")) {
    badgeEl = document.getElementById("flare-badge");
    return;
  }
  if (!document.body) return;

  const badge = document.createElement("div");
  badge.id = "flare-badge";
  Object.assign(badge.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    padding: "8px 14px",
    borderRadius: "24px",
    background:
      "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,58,138,0.8))",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(96,165,250,0.3)",
    boxShadow: "0 4px 20px rgba(37,99,235,0.3), 0 0 8px rgba(96,165,250,0.15)",
    color: "#e2e8f0",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: "13px",
    cursor: "pointer",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    userSelect: "none",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  });

  badge.addEventListener("mouseenter", () => {
    badge.style.transform = "scale(1.08)";
  });
  badge.addEventListener("mouseleave", () => {
    badge.style.transform = "scale(1)";
  });
  badge.addEventListener("click", () => safeSend({ type: "OPEN_SIDE_PANEL" }));

  updateBadgeEl(badge, "Scanning...", "#94a3b8");
  document.body.appendChild(badge);
  badgeEl = badge;
}

function updateBadgeEl(badge: HTMLElement, text: string, color: string): void {
  badge.innerHTML = `
    <span style="font-size:14px;margin-right:2px;">🔥</span>
    <span style="color:${color};font-weight:600;">${text}</span>
  `;
}

function updateBadgeScore(score: number): void {
  ensureBadge();
  if (!badgeEl) return;
  const color = score <= 40 ? "#22c55e" : score <= 70 ? "#eab308" : "#ef4444";
  updateBadgeEl(badgeEl, `${Math.round(score)}%`, color);
}

function updateBadgeText(text: string): void {
  ensureBadge();
  if (!badgeEl) return;
  updateBadgeEl(badgeEl, text, "#94a3b8");
}

// ──────────────────────────────────────────────────────────
// § CSS
// ──────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById("ai-shield-styles")) return;
  const style = document.createElement("style");
  style.id = "ai-shield-styles";
  style.textContent = `
    .ai-shield-blur {
      filter: blur(5px);
      transition: filter 0.2s ease;
      user-select: none;
    }
    .ai-shield-blur:hover {
      filter: blur(3px);
    }
    .ai-shield-revealed {
      filter: none;
      user-select: auto;
    }
    .ai-shield-highlight {
      outline: 3px solid rgba(99, 102, 241, 0.8);
      outline-offset: 2px;
      border-radius: 4px;
      background-color: rgba(99, 102, 241, 0.08);
      transition: outline 0.3s ease, background-color 0.3s ease;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

// ──────────────────────────────────────────────────────────
// § SPA NAVIGATION DETECTION
// ──────────────────────────────────────────────────────────

function resetForNavigation(): void {
  dbg("Navigation detected → resetting.");
  // Clear debug outlines
  document.querySelectorAll("[data-ai-shield-debug]").forEach((el) => {
    (el as HTMLElement).style.outline = "";
    (el as HTMLElement).title = "";
    delete (el as HTMLElement).dataset.aiShieldDebug;
  });
  clearBlur();
  currentAnalysis = null;
  isAnalyzing = false;
  scannedFingerprints.clear();
  blockElements.clear();
  scannedImageSrcs.clear();
  blockIdCounter = 0;
  updateBadgeText("Scanning...");
  debouncedScan();
}

function handleNavigation(): void {
  if (navTimer) clearTimeout(navTimer);
  navTimer = setTimeout(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetForNavigation();
    }
  }, NAV_DEBOUNCE_MS);
}

function hookSpaNavigation(): void {
  // Hook history.pushState and replaceState
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    origPush(...args);
    handleNavigation();
  };
  history.replaceState = function (
    ...args: Parameters<typeof history.replaceState>
  ) {
    origReplace(...args);
    handleNavigation();
  };

  // popstate for back/forward
  window.addEventListener("popstate", handleNavigation);
}

function startContentObserver(): void {
  if (contentObserver) return;
  contentObserver = new MutationObserver((mutations) => {
    let hasNew = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node as Element).id !== "ai-shield-badge" &&
          (node as Element).id !== "ai-shield-styles"
        ) {
          hasNew = true;
          break;
        }
      }
      if (hasNew) break;
    }
    if (!hasNew) return;

    // Check for URL change (SPA frameworks sometimes mutate DOM before pushState)
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      resetForNavigation();
      return;
    }

    // Otherwise just scan for new content (infinite scroll, etc.)
    debouncedScan();
  });

  contentObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
  dbg("Content observer started.");
}

function startBadgeGuard(): void {
  if (badgeGuardInterval) return;
  badgeGuardInterval = setInterval(() => {
    if (!document.getElementById("flare-badge") && document.body) {
      dbg("Badge removed — reattaching.");
      badgeEl = null;
      ensureBadge();
      if (currentAnalysis) updateBadgeScore(currentAnalysis.overallScore);
    }
  }, 5000);
}

// ──────────────────────────────────────────────────────────
// § TEARDOWN
// ──────────────────────────────────────────────────────────

function teardown(): void {
  dbg("Tearing down.");
  if (contentObserver) {
    contentObserver.disconnect();
    contentObserver = null;
  }
  if (badgeGuardInterval) {
    clearInterval(badgeGuardInterval);
    badgeGuardInterval = null;
  }
  if (scanTimer) clearTimeout(scanTimer);
  if (navTimer) clearTimeout(navTimer);
  clearBlur();
  badgeEl?.remove();
  badgeEl = null;
}

// ──────────────────────────────────────────────────────────
// § MESSAGE LISTENER
// ──────────────────────────────────────────────────────────

try {
  chrome.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      if (!chrome?.runtime?.id) {
        teardown();
        return false;
      }

      switch (message.type) {
        case "ANALYSIS_RESULT":
          currentAnalysis = message.payload as PageAnalysis;
          updateBadgeScore(currentAnalysis.overallScore);
          if (settings?.autoBlur) applyCoarseBlur(currentAnalysis);
          sendResponse({ ok: true });
          break;

        case "BLUR_CONTENT":
          // Reload settings to get latest threshold, then apply
          loadSettings().then((s) => {
            settings = s;
            if (currentAnalysis) applyCoarseBlur(currentAnalysis);
          });
          sendResponse({ ok: true });
          break;

        case "CLEAR_BLUR":
          clearBlur();
          sendResponse({ ok: true });
          break;

        case "RECALCULATE_BLUR":
          // Reload settings (threshold may have changed), then reapply or clear
          loadSettings().then((s) => {
            settings = s;
            clearBlur();
            if (settings.autoBlur && currentAnalysis) {
              applyCoarseBlur(currentAnalysis);
            }
          });
          sendResponse({ ok: true });
          break;

        case "EXTRACT_CONTENT_TRIGGER":
          // Force fresh scan (clear fingerprints so everything is re-analyzed)
          scannedFingerprints.clear();
          blockElements.clear();
          blockIdCounter = 0;
          currentAnalysis = null;
          runScan().then(() => sendResponse({ ok: true }));
          return true; // async

        case "HIGHLIGHT_ITEM": {
          const { preview, item } = message.payload || {};
          highlightItem(item?.id || "", preview);
          sendResponse({ ok: true });
          break;
        }

        case "INJECT_DOTS":
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ ok: false });
      }
      return true;
    },
  );
} catch {
  dbg("Failed to register message listener.");
}

// ──────────────────────────────────────────────────────────
// § INIT
// ──────────────────────────────────────────────────────────

async function init(): Promise<void> {
  settings = await loadSettings();
  if (!settings.privacyConsent) {
    dbg("Privacy consent not given.");
    return;
  }

  dbg(`Init on ${location.href}`);
  injectStyles();
  ensureBadge();
  hookSpaNavigation();

  // Delay observers so initial DOM settles
  setTimeout(() => startContentObserver(), 500);
  startBadgeGuard();

  // Google Docs renders its editor well after document_idle — give it extra time.
  // For all other pages 1s is enough; Docs needs ~4s before paragraphs appear.
  const isGoogleDocs = location.hostname.includes("docs.google.com");
  setTimeout(() => runScan(), isGoogleDocs ? 4000 : 1000);
  if (isGoogleDocs) setTimeout(() => runScan(), 8000); // second attempt if still loading
}

// ── Double-init guard ──
declare global {
  interface Window {
    __AI_SHIELD_INITIALIZED__?: boolean;
  }
}

if (window.__AI_SHIELD_INITIALIZED__) {
  dbg("Previous instance detected — cleaning up.");
  teardown();
}
window.__AI_SHIELD_INITIALIZED__ = true;

if (
  document.readyState === "complete" ||
  document.readyState === "interactive"
) {
  init();
} else {
  document.addEventListener("DOMContentLoaded", () => init(), { once: true });
}
