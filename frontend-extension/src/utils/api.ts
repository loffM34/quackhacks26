// ──────────────────────────────────────────────────────────
// API utility — background messaging + direct backend calls
// ──────────────────────────────────────────────────────────

import type { ExtensionMessage, PageAnalysis, ShieldSettings } from "@/types";

/**
 * Send a message to the background service worker and await the response.
 */
export function sendToBackground<T = any>(
  message: ExtensionMessage,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

/**
 * Request a fresh analysis of the current tab (legacy/background flow).
 */
export async function requestAnalysis(): Promise<PageAnalysis | null> {
  return sendToBackground<PageAnalysis | null>({
    type: "ANALYZE_REQUEST",
  });
}

/**
 * Get the cached analysis result for the current tab (legacy/background flow).
 */
export async function getCachedResult(): Promise<PageAnalysis | null> {
  return sendToBackground<PageAnalysis | null>({
    type: "GET_RESULT",
  });
}

/**
 * Update extension settings.
 */
export async function updateSettings(
  settings: Partial<ShieldSettings>,
): Promise<void> {
  return sendToBackground({
    type: "UPDATE_SETTINGS",
    payload: settings,
  });
}

/**
 * Load settings from chrome.storage.sync.
 */
export async function loadSettings(): Promise<ShieldSettings> {
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

// ──────────────────────────────────────────────────────────
// Localized backend API helpers
// ──────────────────────────────────────────────────────────

export type FlagTier = "low" | "medium" | "high";

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

export interface DetectionItemResult {
  id: string;
  score: number; // 0..1 from backend
  tier: FlagTier;
  explanation?: string | null;
  text?: string;
  kind?: string;
  start_char?: number;
  end_char?: number;
}

export interface BackendDetectionResponse {
  score: number; // 0..1
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

async function postJson<TResponse>(
  url: string,
  body: unknown,
): Promise<TResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Backend request failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<TResponse>;
}

export async function detectTextSpans(
  chunks: TextChunkInput[],
  backendUrl?: string,
): Promise<BackendDetectionResponse> {
  const baseUrl = backendUrl || (await loadSettings()).backendUrl;
  return postJson<BackendDetectionResponse>(`${baseUrl}/detect/text/spans`, {
    chunks,
  });
}

export async function detectImageBatch(
  images: ImageInput[],
  backendUrl?: string,
): Promise<BackendDetectionResponse> {
  const baseUrl = backendUrl || (await loadSettings()).backendUrl;
  return postJson<BackendDetectionResponse>(`${baseUrl}/detect/image/batch`, {
    images,
  });
}

export async function detectPage(
  payload: {
    chunks?: TextChunkInput[];
    images?: ImageInput[];
  },
  backendUrl?: string,
): Promise<BackendDetectionResponse> {
  const baseUrl = backendUrl || (await loadSettings()).backendUrl;
  return postJson<BackendDetectionResponse>(`${baseUrl}/detect/page`, payload);
}