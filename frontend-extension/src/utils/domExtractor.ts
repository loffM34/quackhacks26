// ──────────────────────────────────────────────────────────
// DOM Extractor — viewport-only text & image extraction
// ──────────────────────────────────────────────────────────
// Extracts only visible, meaningful content from the page.
// Text extraction is now handled by contentScript.ts's
// extractVisibleText(). This module provides the legacy
// extractPageContent() interface for backward compat +
// image extraction with strict filtering.

import type { PageExtraction } from "@/types";

/** Maximum images to extract */
const MAX_IMAGES = 5;

/** Selectors for elements to SKIP */
const SKIP_SELECTORS = [
  "nav",
  "header",
  "footer",
  "button",
  "svg",
  "input",
  "script",
  "style",
  "noscript",
  "iframe",
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="tooltip"]',
  '[role="dialog"]',
  ".nav",
  ".navbar",
  ".sidebar",
  ".advertisement",
  ".ad",
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

function isInsideSkipped(el: Element, skipSet: Set<Element>): boolean {
  let current: Element | null = el;
  while (current) {
    if (skipSet.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * Extract page content — images only (text is handled by contentScript).
 * This function is still called for backward compat with background.ts.
 */
export function extractPageContent(): PageExtraction {
  const images: string[] = [];

  // Build skip set
  const skipElements = new Set<Element>();
  SKIP_SELECTORS.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => skipElements.add(el));
  });

  // ── Extract images (viewport-visible, large only) ──
  const imgElements = document.querySelectorAll("img[src]");
  for (const img of imgElements) {
    if (images.length >= MAX_IMAGES) break;
    if (isInsideSkipped(img, skipElements)) continue;
    if (!isInViewport(img)) continue;

    const el = img as HTMLImageElement;
    const src = el.src;
    const width = el.naturalWidth || el.width;
    const height = el.naturalHeight || el.height;

    // Skip small images (icons, avatars, UI elements)
    if (width < 200 || height < 200) continue;

    // Skip SVG data URIs
    if (src.startsWith("data:image/svg")) continue;

    // Skip common icon/logo patterns
    if (/\/(icon|logo|avatar|favicon|badge|emoji|sticker)/i.test(src)) continue;

    // Skip tiny base64 images (< 5KB)
    if (src.startsWith("data:") && src.length < 7000) continue;

    images.push(src);
  }

  return {
    url: window.location.href,
    title: document.title,
    containers: [], // Text is now extracted by contentScript directly
    images,
  };
}
