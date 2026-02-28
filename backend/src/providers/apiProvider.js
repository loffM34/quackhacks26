// ──────────────────────────────────────────────────────────
// API Provider — External AI detection APIs
// ──────────────────────────────────────────────────────────
// Calls hosted detection services (GPTZero, Originality.ai,
// Sapling, HuggingFace). Supports multiple APIs via config.
// For hackathon MVP: uses GPTZero by default with fallback to
// HuggingFace Inference API.
//
// API_PROVIDER_NAME env var selects which API to call.

import axios from "axios";
import { config } from "../config.js";

/**
 * API Provider — implements the detectProvider interface.
 * Delegates to the configured external API.
 */
export const apiProvider = {
  /**
   * Analyze text using an external AI detection API.
   * @param text — text to analyze
   * @returns { score: 0–1 probability, provider: string, details?: object }
   */
  async analyzeText(text) {
    const apiName = config.apiProviderName;

    switch (apiName) {
      case "gptzero":
        return callGptZero(text);
      case "sapling":
        return callSapling(text);
      case "huggingface":
        return callHuggingFace(text);
      case "originality":
        return callOriginality(text);
      default:
        // Fallback: return a mock score for development
        console.warn(
          `[apiProvider] Unknown API "${apiName}", returning mock score`,
        );
        return mockTextScore(text);
    }
  },

  /**
   * Analyze an image using an external AI detection API.
   * Image detection APIs are less common — for MVP, use HuggingFace
   * or return a mock score.
   * @param imageData — base64 data URI
   * @returns { score: 0–1, provider: string }
   */
  async analyzeImage(imageData) {
    try {
      return await callHuggingFaceImage(imageData);
    } catch {
      // Don't return a fake score—just return 0 so we don't report a false positive
      console.warn("[apiProvider] Image analysis failed, returning 0 score");
      return {
        score: 0,
        provider: "huggingface-image",
        error: "analysis_failed",
        details: { note: "Image analysis unavailable" },
      };
    }
  },
};

// ──────────────────────────────────────────────────────────
// Individual API implementations
// ──────────────────────────────────────────────────────────

/**
 * GPTZero API — https://gptzero.me/docs
 * POST https://api.gptzero.me/v2/predict/text
 */
async function callGptZero(text) {
  const apiKey = config.gptZeroApiKey;
  if (!apiKey) return mockTextScore(text);

  try {
    const response = await axios.post(
      "https://api.gptzero.me/v2/predict/text",
      { document: text },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        timeout: 10000,
      },
    );

    const data = response.data;
    // GPTZero returns completely_generated_prob (0–1)
    const score = data?.documents?.[0]?.completely_generated_prob ?? 0;

    return {
      score,
      provider: "gptzero",
      details: {
        sentences: data?.documents?.[0]?.sentences?.map((s) => ({
          text: s.sentence,
          score: s.generated_prob,
        })),
      },
    };
  } catch (err) {
    console.error("[apiProvider] GPTZero error:", err.message);
    throw err;
  }
}

/**
 * Sapling AI Detector — https://sapling.ai/docs/api/detector
 * POST https://api.sapling.ai/api/v1/aidetect
 */
async function callSapling(text) {
  const apiKey = config.saplingApiKey;
  if (!apiKey) return mockTextScore(text);

  try {
    const response = await axios.post(
      "https://api.sapling.ai/api/v1/aidetect",
      { key: apiKey, text },
      { timeout: 10000 },
    );

    const score = response.data?.score ?? 0;
    return {
      score,
      provider: "sapling",
      details: { sentence_scores: response.data?.sentence_scores },
    };
  } catch (err) {
    console.error("[apiProvider] Sapling error:", err.message);
    throw err;
  }
}

/**
 * HuggingFace Inference API — text classification
 * Uses a public AI-detection model (e.g., roberta-base-openai-detector)
 */
async function callHuggingFace(text) {
  const apiKey = config.huggingfaceApiKey;
  const model = "openai-community/roberta-base-openai-detector";

  try {
    const response = await axios.post(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      { inputs: text.slice(0, 1024) }, // model input limit
      {
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: 15000,
      },
    );

    // HuggingFace returns [[{ label, score }]] where label is "Fake" or "Real"
    const predictions = response.data?.[0] || [];
    const fakeScore = predictions.find((p) => p.label === "Fake")?.score ?? 0;

    return {
      score: fakeScore,
      provider: "huggingface",
      details: { predictions },
    };
  } catch (err) {
    console.error("[apiProvider] HuggingFace error:", err.message);
    return {
      score: 0,
      provider: "huggingface",
      error: "API timeout or error",
      details: { error: err.message },
    };
  }
}

/**
 * Originality.ai — https://docs.originality.ai
 * POST https://api.originality.ai/api/v1/scan/ai
 */
async function callOriginality(text) {
  const apiKey = config.originalityApiKey;
  if (!apiKey) return mockTextScore(text);

  try {
    const response = await axios.post(
      "https://api.originality.ai/api/v1/scan/ai",
      { content: text },
      {
        headers: {
          "Content-Type": "application/json",
          "X-OAI-API-KEY": apiKey,
        },
        timeout: 10000,
      },
    );

    const score = response.data?.score?.ai ?? 0;
    return {
      score,
      provider: "originality",
      details: response.data,
    };
  } catch (err) {
    console.error("[apiProvider] Originality error:", err.message);
    throw err;
  }
}

/**
 * HuggingFace image classification for AI-generated image detection
 */
async function callHuggingFaceImage(imageData) {
  const apiKey = config.huggingfaceApiKey;
  // Use an AI-image-detection model
  const model = "umm-maybe/AI-image-detector";

  // Convert base64 data URI to raw binary
  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  try {
    const response = await axios.post(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      buffer,
      {
        headers: {
          "Content-Type": "application/octet-stream",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: 15000,
      },
    );

    // Returns [{ label, score }] — look for "artificial" label
    const predictions = response.data || [];
    const aiScore =
      predictions.find(
        (p) =>
          p.label?.toLowerCase().includes("artificial") ||
          p.label?.toLowerCase().includes("ai"),
      )?.score ?? 0;

    return {
      score: aiScore,
      provider: "huggingface-image",
      details: { predictions },
    };
  } catch (err) {
    console.error("[apiProvider] HuggingFace image error:", err.message);
    throw err;
  }
}

// ──────────────────────────────────────────────────────────
// Mock scores for development (when no API keys are configured)
// ──────────────────────────────────────────────────────────

function mockTextScore(text) {
  // Generate a deterministic but varied mock score based on text length
  const hash = simpleHash(text);
  const score = ((hash % 80) + 10) / 100; // 0.10 – 0.90
  return {
    score,
    provider: "mock",
    details: {
      note: "Mock score — configure API keys for real detection",
    },
  };
}

function mockImageScore() {
  const score = Math.random() * 0.6 + 0.2; // 0.20 – 0.80
  return {
    score,
    provider: "mock",
    details: { note: "Mock score — configure API keys for real detection" },
  };
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
