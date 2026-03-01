// ──────────────────────────────────────────────────────────
// Detection Service — Adapter Pattern
// ──────────────────────────────────────────────────────────

import { config } from "../config.js";
import { apiProvider } from "../providers/apiProvider.js";
import { pythonProvider } from "../providers/pythonProvider.js";

/**
 * Provider interface (duck-typed):
 *   analyzeText(text: string): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeImage(imageData: string): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeTextSpans?(chunks: Array<object>): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeImageBatch?(images: Array<object>): Promise<{ score: number, provider: string, details?: any }>
 *   analyzePage?(payload: object): Promise<{ score: number, provider: string, details?: any }>
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
 *   DETECT_PROVIDER=api     → External APIs
 *   DETECT_PROVIDER=python  → Local FastAPI model service
 */
export const detectService = {
  /**
   * Analyze text for AI-generated content probability.
   * @param {string} text
   */
  async analyzeText(text) {
    const provider = getProvider();
    return provider.analyzeText(text);
  },

  /**
   * Analyze an image for AI-generated content probability.
   * @param {string} imageData
   */
  async analyzeImage(imageData) {
    const provider = getProvider();
    return provider.analyzeImage(imageData);
  },

  /**
   * Analyze multiple text chunks and return localized results.
   * @param {Array<{id:string,text:string,kind?:string,start_char?:number,end_char?:number}>} chunks
   */
  async analyzeTextSpans(chunks) {
    const provider = getProvider();
    if (typeof provider.analyzeTextSpans !== "function") {
      throw new Error(`Provider "${config.detectProvider}" does not support text span analysis`);
    }
    return provider.analyzeTextSpans(chunks);
  },

  /**
   * Analyze multiple images and return per-image results.
   * @param {Array<{id:string,image:string}>} images
   */
  async analyzeImageBatch(images) {
    const provider = getProvider();
    if (typeof provider.analyzeImageBatch !== "function") {
      throw new Error(`Provider "${config.detectProvider}" does not support image batch analysis`);
    }
    return provider.analyzeImageBatch(images);
  },

  /**
   * Analyze a page payload containing text chunks and images.
   * @param {{chunks?:Array<object>, images?:Array<object>}} payload
   */
  async analyzePage(payload) {
    const provider = getProvider();
    if (typeof provider.analyzePage !== "function") {
      throw new Error(`Provider "${config.detectProvider}" does not support page analysis`);
    }
    return provider.analyzePage(payload);
  },

  /** Get the name of the currently active provider */
  getProviderName() {
    return config.detectProvider;
  },
};