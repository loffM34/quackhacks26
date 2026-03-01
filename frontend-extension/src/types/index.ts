// ──────────────────────────────────────────────────────────
// Shared TypeScript types for AI Content Shield
// ──────────────────────────────────────────────────────────

export type FlagTier = "low" | "medium" | "high";
export type ScoreColor = "safe" | "caution" | "danger";

export interface DetectionItemResult {
  id: string;
  /** backend may return 0..1 or 0..100 */
  score: number;
  tier?: FlagTier;
  explanation?: string | null;

  /** optional text fields from backend */
  text?: string;
  kind?: string;
  start_char?: number;
  end_char?: number;
}

export interface ContentScore {
  id: string;
  type: "text" | "image";
  /** normalized to 0..100 in extension state */
  score: number;
  tier: FlagTier;
  preview: string;
  provider: string;
  explanation?: string | null;
}

export interface PageAnalysis {
  overallScore: number;
  textScore: number;
  imageScore: number;
  aiDensity: number;
  items: ContentScore[];
  url: string;
  analyzedAt: number;
  cached: boolean;
}

export interface ExtractedContainerData {
  id: string;
  text: string;
}

export interface PageExtraction {
  url: string;
  title: string;
  containers: ExtractedContainerData[];
  images: string[];
}

export interface ExtensionMessage {
  type:
    | "EXTRACT_CONTENT"
    | "ANALYSIS_RESULT"
    | "ANALYZE_REQUEST"
    | "GET_RESULT"
    | "UPDATE_SETTINGS"
    | "BLUR_CONTENT"
    | "INJECT_DOTS"
    | "OPEN_SIDE_PANEL"
    | "EXTRACT_CONTENT_TRIGGER"
    | "HIGHLIGHT_ITEM";
  payload?: any;
}

export interface ShieldSettings {
  threshold: number;
  autoBlur: boolean;
  elderMode: boolean;
  privacyConsent: boolean;
  showSearchDots: boolean;
  backendUrl: string;
}

export const DEFAULT_SETTINGS: ShieldSettings = {
  threshold: 70,
  autoBlur: false,
  elderMode: false,
  privacyConsent: true,
  showSearchDots: true,
  backendUrl: "http://localhost:3001",
};

export interface TextChunkInput {
  id: string;
  text: string;
  kind?: string;
  start_char?: number;
  end_char?: number;
}

export interface ImageInput {
  id: string;
  image: string;
}

export interface BackendDetectionResponse {
  /** backend may return 0..1 or 0..100 */
  score: number;
  provider: string;
  details?: {
    results?: DetectionItemResult[];
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

export interface DetectTextResponse extends BackendDetectionResponse {}
export interface DetectImageResponse extends BackendDetectionResponse {}

export function getScoreColor(score: number): ScoreColor {
  if (score <= 40) return "safe";
  if (score <= 70) return "caution";
  return "danger";
}

export function getScoreColorClass(score: number): string {
  const color = getScoreColor(score);
  const map: Record<ScoreColor, string> = {
    safe: "text-score-safe",
    caution: "text-score-caution",
    danger: "text-score-danger",
  };
  return map[color];
}