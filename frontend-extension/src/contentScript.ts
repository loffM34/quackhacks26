// ──────────────────────────────────────────────────────────
// Content Script — localized text/image detection
// ──────────────────────────────────────────────────────────

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

console.log("[AI Shield] Content script initialized. Ready to scan.");

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

const INIT_DELAY_MS = 1500;

// ──────────────────────────────────────────────────────────
// Main init
// ──────────────────────────────────────────────────────────

async function init(): Promise<void> {
  settings = await loadSettings();

  if (!settings.privacyConsent) {
    console.log("[AI Shield] Privacy consent not given, skipping analysis.");
    return;
  }

  injectFloatingBadge(null);

  const extraction = extractPageContent();

  if (extraction.paragraphs.length === 0 && extraction.images.length === 0) {
    console.log("[AI Shield] No meaningful content found on page.");
    renderBadgeEmpty();
    return;
  }

  const textChunks = buildTextChunks(extraction.paragraphs);
  const compressedImages = await compressImages(extraction.images);
  const imageInputs: ImageInput[] = compressedImages.map((image, idx) => ({
    id: `img_${idx + 1}`,
    image,
  }));

  try {
    const [textResponse, imageResponse] = await Promise.all([
      textChunks.length > 0
        ? detectTextSpans(textChunks, settings.backendUrl)
        : Promise.resolve<BackendDetectionResponse>({
            score: 0,
            provider: "none",
            details: { results: [] },
          }),
      imageInputs.length > 0
        ? detectImageBatch(imageInputs, settings.backendUrl)
        : Promise.resolve<BackendDetectionResponse>({
            score: 0,
            provider: "none",
            details: { results: [] },
          }),
    ]);

    const analysis = toLocalizedPageAnalysis(textResponse, imageResponse);
    handleAnalysisResult(analysis);
  } catch (err) {
    console.warn("[AI Shield] Analysis failed:", err);
    renderBadgeError();
  }
}

// ──────────────────────────────────────────────────────────
// Transformation helpers
// ──────────────────────────────────────────────────────────

function buildTextChunks(paragraphs: string[]): TextChunkInput[] {
  const chunks: TextChunkInput[] = [];
  let counter = 1;

  for (const paragraph of paragraphs) {
    const clean = (paragraph || "").replace(/\s+/g, " ").trim();
    if (clean.length < 20) continue;

    const sentenceParts = clean
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 20);

    if (sentenceParts.length === 0) {
      chunks.push({
        id: `t_${counter++}`,
        text: clean.slice(0, 1200),
        kind: "paragraph",
      });
      continue;
    }

    for (const sentence of sentenceParts) {
      chunks.push({
        id: `t_${counter++}`,
        text: sentence.slice(0, 1000),
        kind: "sentence",
      });
    }
  }

  return chunks;
}

function toLocalizedPageAnalysis(
  textResponse: BackendDetectionResponse,
  imageResponse: BackendDetectionResponse,
): LocalizedPageAnalysis {
  const textResults = textResponse.details?.results ?? [];
  const imageResults = imageResponse.details?.results ?? [];

  const textScore = Math.round((textResponse.score ?? 0) * 100);
  const imageScore = Math.round((imageResponse.score ?? 0) * 100);

  let overallScore = 0;
  if (textResults.length > 0 && imageResults.length > 0) {
    overallScore = Math.round(textScore * 0.4 + imageScore * 0.6);
  } else if (imageResults.length > 0) {
    overallScore = imageScore;
  } else if (textResults.length > 0) {
    overallScore = textScore;
  }

  return {
    overallScore,
    textScore,
    imageScore,
    textResults,
    imageResults,
  };
}

// ──────────────────────────────────────────────────────────
// Analysis handling
// ──────────────────────────────────────────────────────────

function handleAnalysisResult(analysis: LocalizedPageAnalysis): void {
  currentAnalysis = analysis;

  injectFloatingBadge(analysis.overallScore);

  applyTextHighlights(analysis.textResults);
  applyImageBadges(analysis.imageResults);

  if (
    settings?.autoBlur &&
    analysis.overallScore > (settings?.threshold ?? 70)
  ) {
    applyContentBlur(analysis);
  }

  if (isGoogleSearchPage()) {
    injectSearchDots();
  }
}

// ──────────────────────────────────────────────────────────
// Badge UI
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

  badge.addEventListener("mouseenter", () => {
    badge.style.transform = "scale(1.08)";
    badge.style.boxShadow = `0 6px 24px rgba(10,26,74,0.5), inset 0 1px 1px rgba(148,163,184,0.2), 0 0 30px 4px ${bgColor}`;
  });

  badge.addEventListener("mouseleave", () => {
    badge.style.transform = "scale(1)";
    badge.style.boxShadow = `0 4px 16px rgba(10,26,74,0.4), inset 0 1px 1px rgba(148,163,184,0.15), 0 0 20px 2px ${bgColor}`;
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

  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";

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
      flexShrink: "0",
    });

    h3.insertBefore(dot, h3.firstChild);
  });
}

// ──────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// ──────────────────────────────────────────────────────────
// Message handling
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
        init().then(() => sendResponse({ ok: true }));
        return true;

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
    return true;
  },
);

// ──────────────────────────────────────────────────────────
// SPA support
// ──────────────────────────────────────────────────────────

let lastUrl = window.location.href;

setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    console.log("[AI Shield] URL changed, re-initializing...");
    if (badgeElement) badgeElement.remove();
    badgeElement = null;
    currentAnalysis = null;
    setTimeout(init, Math.max(INIT_DELAY_MS, 1500));
  }
}, 1000);

// ──────────────────────────────────────────────────────────
// Start
// ──────────────────────────────────────────────────────────

if (document.readyState === "complete") {
  setTimeout(init, INIT_DELAY_MS);
} else {
  window.addEventListener("load", () => setTimeout(init, INIT_DELAY_MS));
}