// ──────────────────────────────────────────────────────────
// DOM Extractor — extracts clean text & images from web pages
// ──────────────────────────────────────────────────────────
// Heuristics: removes nav, ads, comments, short paragraphs.
// Returns top N paragraphs and M images for analysis.

import type { PageExtraction } from "@/types";

/** Maximum number of paragraphs to extract */
const MAX_PARAGRAPHS = 20;
/** Maximum number of images to extract */
const MAX_IMAGES = 5;
/** Minimum paragraph length to include (chars) */
const MIN_PARAGRAPH_LENGTH = 100;
/** Maximum characters per paragraph sent to API */
const MAX_PARAGRAPH_CHARS = 4000;

/** Selectors for elements to SKIP during extraction */
const SKIP_SELECTORS = [
  "nav",
  "header",
  "footer",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  ".nav",
  ".navbar",
  ".header",
  ".footer",
  ".sidebar",
  ".advertisement",
  ".ad",
  '[class*="advert"]',
  '[id*="advert"]',
  ".comment",
  ".comments",
  "#comments",
  '[class*="comment"]',
  "script",
  "style",
  "noscript",
  "iframe",
  "button",
  "svg",
  "path",
  ".social-share",
  ".share-buttons",
  ".cookie-banner",
  ".cookie-notice",
  '[aria-hidden="true"]',
  '[role="tooltip"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="menubar"]',
  ".sr-only", // screen reader text
  ".sr-only-focusable",
  '[class*="hidden"]',
  '[class*="sr-only"]',
  '[class*="visually-hidden"]',
  '[class*="tooltip"]',
  '[class*="menu"]',
  '[class*="button"]',
];

/**
 * Extract visible, meaningful text paragraphs and images from the current page.
 * Filters out navigation, ads, comments, and very short text.
 */
export function extractPageContent(): PageExtraction {
  const paragraphs: string[] = [];
  const images: string[] = [];

  // Build a Set of elements to skip
  const skipElements = new Set<Element>();
  SKIP_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => skipElements.add(el));
  });

  // ── Extract text paragraphs ──
  const textElements = document.querySelectorAll(
    'p, article, [role="main"] p, .post-content p, .article-body p, .entry-content p',
  );

  for (const el of textElements) {
    if (paragraphs.length >= MAX_PARAGRAPHS) break;

    // Skip if inside a filtered container
    if (isInsideSkipped(el, skipElements)) continue;

    // Get visible text (skip hidden elements)
    const text = cleanText(el.textContent || "");
    if (text.length < MIN_PARAGRAPH_LENGTH) continue;

    // Truncate very long paragraphs
    const trimmed =
      text.length > MAX_PARAGRAPH_CHARS
        ? text.slice(0, MAX_PARAGRAPH_CHARS) + "…"
        : text;

    // Avoid duplicates
    if (!paragraphs.includes(trimmed)) {
      paragraphs.push(trimmed);
    }
  }

  // If we got very few paragraphs from <p>, try broader selectors
  if (paragraphs.length < 3) {
    const divs = document.querySelectorAll("div, section, main");
    for (const el of divs) {
      if (paragraphs.length >= MAX_PARAGRAPHS) break;
      if (isInsideSkipped(el, skipElements)) continue;

      const text = cleanText(el.textContent || "");
      if (text.length < MIN_PARAGRAPH_LENGTH * 2) continue; // higher bar for divs
      if (text.length > MAX_PARAGRAPH_CHARS) continue; // skip huge containers

      if (!paragraphs.some((p) => text.includes(p) || p.includes(text))) {
        paragraphs.push(text);
      }
    }
  }

  // ── Extract images ──
  const imgElements = document.querySelectorAll("img[src]");
  for (const img of imgElements) {
    if (images.length >= MAX_IMAGES) break;
    if (isInsideSkipped(img, skipElements)) continue;

    const src = (img as HTMLImageElement).src;
    const width =
      (img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width;
    const height =
      (img as HTMLImageElement).naturalHeight ||
      (img as HTMLImageElement).height;

    // Skip tiny images (icons, tracking pixels)
    if (width < 100 || height < 100) continue;
    // Skip data URIs that are too small or SVGs
    if (src.startsWith("data:image/svg")) continue;

    images.push(src);
  }

  return {
    url: window.location.href,
    title: document.title,
    paragraphs,
    images,
  };
}

/** Check if an element is inside any of the skipped containers */
function isInsideSkipped(el: Element, skipSet: Set<Element>): boolean {
  let current: Element | null = el;
  while (current) {
    if (skipSet.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

/** Clean and normalize text: collapse whitespace, trim */
function cleanText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}
