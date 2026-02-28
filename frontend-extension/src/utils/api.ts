// ──────────────────────────────────────────────────────────
// API utility — type-safe chrome.runtime messaging wrapper
// ──────────────────────────────────────────────────────────
// All communication from UI ↔ background uses these helpers.

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
 * Request a fresh analysis of the current tab.
 */
export async function requestAnalysis(): Promise<PageAnalysis | null> {
  return sendToBackground<PageAnalysis | null>({
    type: "ANALYZE_REQUEST",
  });
}

/**
 * Get the cached analysis result for the current tab.
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
