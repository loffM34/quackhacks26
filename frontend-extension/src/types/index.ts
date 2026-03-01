// ──────────────────────────────────────────────────────────
// Shared TypeScript types for AI Content Shield
// ──────────────────────────────────────────────────────────

/** Per-item risk tier returned by the backend */
export type FlagTier = "low" | "medium" | "high";

/** Color state based on score */
export type ScoreColor = "safe" | "caution" | "danger";

/** A localized detection result for a text chunk or image */
export interface DetectionItemResult {
  /** Unique ID for this content item */
  id: string;
  /** 0..1 score returned by backend */
  score: number;
  /** Risk tier derived by backend */
  tier: FlagTier;
  /** Optional explanation for medium/high results */
  explanation?: string | null;

  /** Optional text-specific fields */
  text?: string;
  kind?: "sentence" | "paragraph" | string;
  start_char?: number;
  end_char?: number;
}

/** Score for a single piece of content in the UI */
export interface ContentScore {
  /** Unique ID for this content item */
  id: string;
  /** Type of content analyzed */
  type: "text" | "image";
  /** AI-generated probability 0–100 */
  score: number;
  /** Tier label for UI */
  tier: FlagTier;
  /** Short excerpt or label for reference */
  preview: string;
  /** Provider that generated this score */
  provider: string;
  /** Optional explanation shown in tooltips/details */
  explanation?: string | null;
}

/** Aggregated page-level analysis result used by the extension UI */
export interface PageAnalysis {
  /** Overall page AI score (weighted average), 0–100 */
  overallScore: number;
  /** Text-only average score, 0–100 */
  textScore: number;
  /** Image-only average score, 0–100 */
  imageScore: number;
  /** Percentage of items flagged as medium/high */
  aiDensity: number;
  /** Flattened individual content scores for UI/panels */
  items: ContentScore[];
  /** URL of the analyzed page */
  url: string;
  /** Timestamp of analysis */
  analyzedAt: number;
  /** Whether this result came from cache */
  cached: boolean;

  /** Localized backend results */
  textResults?: DetectionItemResult[];
  imageResults?: DetectionItemResult[];
}

/** Data extracted from a web page by the content script */
export interface PageExtraction {
  /** Page URL */
  url: string;
  /** Extracted text paragraphs (cleaned, trimmed) */
  paragraphs: string[];
  /** Image URLs or base64 data URIs (compressed) */
  images: string[];
  /** Page title */
  title: string;
}

/** Message sent between content script ↔ background */
export interface ExtensionMessage {
  type:
    | "EXTRACT_CONTENT" // content script → background: page content ready
    | "ANALYSIS_RESULT" // background → content script: scores ready
    | "ANALYZE_REQUEST" // popup/panel → background: user clicked Analyze
    | "GET_RESULT" // popup/panel → background: get cached result
    | "UPDATE_SETTINGS" // popup → background: settings changed
    | "BLUR_CONTENT" // background → content script: apply/remove blur
    | "INJECT_DOTS" // background → content script: Google search dots
    | "OPEN_SIDE_PANEL" // badge → background: open side panel
    | "EXTRACT_CONTENT_TRIGGER" // background → content script: trigger fresh extraction
    | "HIGHLIGHT_ITEM"; // sidepanel → content script: scroll to and highlight a content item
  payload?: any;
}

/** User-configurable settings stored in chrome.storage */
export interface ShieldSettings {
  /** AI score threshold for flagging (0–100), default 70 */
  threshold: number;
  /** Whether to auto-blur content above threshold */
  autoBlur: boolean;
  /** Elder Mode — large fonts and simplified UI */
  elderMode: boolean;
  /** Whether user has opted into sending content for analysis */
  privacyConsent: boolean;
  /** Whether to show Google search result dots */
  showSearchDots: boolean;
  /** Backend API URL */
  backendUrl: string;
}

/** Default settings */
export const DEFAULT_SETTINGS: ShieldSettings = {
  threshold: 70,
  autoBlur: false,
  elderMode: false,
  privacyConsent: true,
  showSearchDots: true,
  backendUrl: "http://localhost:3001",
};

/** Request shape for localized text analysis */
export interface TextChunkInput {
  id: string;
  text: string;
  kind?: string;
  start_char?: number;
  end_char?: number;
}

/** Request shape for localized image analysis */
export interface ImageInput {
  id: string;
  image: string;
}

/** Generic backend detection response */
export interface BackendDetectionResponse {
  /** 0..1 score */
  score: number;
  provider: string;
  details?: {
    /** Used by /detect/text/spans and /detect/image/batch */
    results?: DetectionItemResult[];

    /** Used by /detect/page */
    text?: {
      score?: number;
      results?: DetectionItemResult[];
    };
    images?: {
      score?: number;
      results?: DetectionItemResult[];
    };

    overall_tier?: FlagTier;
    flagged_count?: number;
  };
  latency_ms?: number;
  cached?: boolean;
}

/** Backward-compatible response from /detect/text */
export interface DetectTextResponse extends BackendDetectionResponse {}

/** Backward-compatible response from /detect/image */
export interface DetectImageResponse extends BackendDetectionResponse {}

/** Get the color state for a given 0–100 score */
export function getScoreColor(score: number): ScoreColor {
  if (score <= 40) return "safe";
  if (score <= 70) return "caution";
  return "danger";
}

/** Get Tailwind color class for a 0–100 score */
export function getScoreColorClass(score: number): string {
  const color = getScoreColor(score);
  const map: Record<ScoreColor, string> = {
    safe: "text-score-safe",
    caution: "text-score-caution",
    danger: "text-score-danger",
  };
  return map[color];
}

/** Flatten localized results into panel-friendly content items */
export function buildContentScores(params: {
  textResults?: DetectionItemResult[];
  imageResults?: DetectionItemResult[];
  provider?: string;
}): ContentScore[] {
  const provider = params.provider || "python-model";

  const textItems: ContentScore[] = (params.textResults || []).map((item) => ({
    id: item.id,
    type: "text",
    score: Math.round((item.score || 0) * 100),
    tier: item.tier,
    preview: item.text
      ? item.text.slice(0, 160)
      : item.kind
        ? `[${item.kind}]`
        : "[text]",
    provider,
    explanation: item.explanation ?? null,
  }));

  const imageItems: ContentScore[] = (params.imageResults || []).map((item) => ({
    id: item.id,
    type: "image",
    score: Math.round((item.score || 0) * 100),
    tier: item.tier,
    preview: item.id,
    provider,
    explanation: item.explanation ?? null,
  }));

  return [...textItems, ...imageItems];
}

/** Compute percent of localized items flagged medium/high */
export function computeAiDensity(items: Array<{ tier?: FlagTier }>): number {
  if (!items.length) return 0;
  const flagged = items.filter(
    (item) => item.tier === "medium" || item.tier === "high",
  ).length;
  return Math.round((flagged / items.length) * 100);
}
