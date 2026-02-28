// ──────────────────────────────────────────────────────────
// Detection Service — Adapter Pattern
// ──────────────────────────────────────────────────────────
// Central service that delegates to the active provider based
// on DETECT_PROVIDER env var. Providers implement analyzeText()
// and analyzeImage() with a uniform return shape.

import { config } from "../config.js";
import { apiProvider } from "../providers/apiProvider.js";
import { pythonProvider } from "../providers/pythonProvider.js";

/**
 * Provider interface (duck-typed):
 *   analyzeText(text: string): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeImage(imageData: string): Promise<{ score: number, provider: string, details?: any }>
 */

// ── Provider registry ──
const providers = {
  api: apiProvider,
  python: pythonProvider,
};

/**
 * Get the active provider based on configuration.
 * Falls back to API provider if the configured one doesn't exist.
 */
function getProvider() {
  const provider = providers[config.detectProvider];
  if (!provider) {
    console.warn(
      `[DetectService] Unknown provider "${config.detectProvider}", falling back to "api"`,
    );
    return providers.api;
  }
  return provider;
}

/**
 * Detection service with adapter pattern.
 * Swap providers by changing DETECT_PROVIDER env var:
 *   DETECT_PROVIDER=api     → External APIs (GPTZero, Originality, etc.)
 *   DETECT_PROVIDER=python  → Local FastAPI model service
 */
export const detectService = {
  /**
   * Analyze text for AI-generated content probability.
   * @param text — cleaned text to analyze
   * @returns { score: 0–1, provider: string, details?: object }
   */
  async analyzeText(text) {
    const provider = getProvider();
    return provider.analyzeText(text);
  },

  /**
   * Analyze an image for AI-generated content probability.
   * @param imageData — base64 data URI or image URL
   * @returns { score: 0–1, provider: string, details?: object }
   */
  async analyzeImage(imageData) {
    const provider = getProvider();
    return provider.analyzeImage(imageData);
  },

  /** Get the name of the currently active provider */
  getProviderName() {
    return config.detectProvider;
  },
};
