// ──────────────────────────────────────────────────────────
// Shared TypeScript types for AI Content Shield
// ──────────────────────────────────────────────────────────

/** Score for a single piece of content (text paragraph or image) */
export interface ContentScore {
  /** Unique ID for this content item */
  id: string;
  /** Type of content analyzed */
  type: "text" | "image";
  /** AI-generated probability 0–100 */
  score: number;
  /** Short excerpt or image URL for reference */
  preview: string;
  /** Provider that generated this score */
  provider: string;
}

/** Aggregated page-level analysis result */
export interface PageAnalysis {
  /** Overall page AI score (weighted average), 0–100 */
  overallScore: number;
  /** Text-only average score */
  textScore: number;
  /** Image-only average score */
  imageScore: number;
  /** Percentage of paragraphs flagged as likely AI (score > threshold) */
  aiDensity: number;
  /** Individual content scores */
  items: ContentScore[];
  /** URL of the analyzed page */
  url: string;
  /** Timestamp of analysis */
  analyzedAt: number;
  /** Whether this result came from cache */
  cached: boolean;
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
    | "EXTRACT_CONTENT_TRIGGER"; // background → content script: trigger fresh extraction
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

/** Response from the backend /detect/text endpoint */
export interface DetectTextResponse {
  score: number;
  provider: string;
  details?: {
    sentences?: Array<{ text: string; score: number }>;
  };
  cached: boolean;
}

/** Response from the backend /detect/image endpoint */
export interface DetectImageResponse {
  score: number;
  provider: string;
  details?: Record<string, any>;
  cached: boolean;
}

/** Color state based on score */
export type ScoreColor = "safe" | "caution" | "danger";

/** Get the color state for a given score */
export function getScoreColor(score: number): ScoreColor {
  if (score <= 40) return "safe";
  if (score <= 70) return "caution";
  return "danger";
}

/** Get Tailwind color class for a score */
export function getScoreColorClass(score: number): string {
  const color = getScoreColor(score);
  const map: Record<ScoreColor, string> = {
    safe: "text-score-safe",
    caution: "text-score-caution",
    danger: "text-score-danger",
  };
  return map[color];
}
