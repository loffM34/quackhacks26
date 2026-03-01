// ──────────────────────────────────────────────────────────
// Detection Service — Adapter Pattern
// ──────────────────────────────────────────────────────────

import { config } from "../config.js";
import { apiProvider } from "../providers/apiProvider.js";
import { pythonProvider } from "../providers/pythonProvider.js";
import { hiveImageProvider } from "../providers/hiveImageProvider.js";

/**
 * Provider interface (duck-typed):
 *   analyzeText(text: string): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeImage(imageData: string): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeTextSpans?(chunks: Array<object>): Promise<{ score: number, provider: string, details?: any }>
 *   analyzeImageBatch?(images: Array<object>): Promise<{ score: number, provider: string, details?: any }>
 *   analyzePage?(payload: object): Promise<{ score: number, provider: string, details?: any }>
 */

const providers = {
  api: apiProvider,
  python: pythonProvider,
};

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

export const detectService = {
  async analyzeText(text) {
    const provider = getProvider();
    return provider.analyzeText(text);
  },

  async analyzeImage(imageData) {
    if (config.hiveApiKey) {
      return hiveImageProvider.analyzeImage(imageData);
    }
    const provider = getProvider();
    return provider.analyzeImage(imageData);
  },

  async analyzeTextSpans(chunks) {
    const provider = getProvider();
    if (typeof provider.analyzeTextSpans !== "function") {
      throw new Error(
        `Provider "${config.detectProvider}" does not support text span analysis`,
      );
    }
    return provider.analyzeTextSpans(chunks);
  },

  async analyzeImageBatch(images) {
    if (config.hiveApiKey) {
      return hiveImageProvider.analyzeImageBatch(images);
    }
    const provider = getProvider();
    if (typeof provider.analyzeImageBatch !== "function") {
      throw new Error(
        `Provider "${config.detectProvider}" does not support image batch analysis`,
      );
    }
    return provider.analyzeImageBatch(images);
  },

  async analyzePage(payload) {
    const provider = getProvider();
    if (typeof provider.analyzePage !== "function") {
      throw new Error(
        `Provider "${config.detectProvider}" does not support page analysis`,
      );
    }
    return provider.analyzePage(payload);
  },

  getProviderName() {
    return config.detectProvider;
  },
};
