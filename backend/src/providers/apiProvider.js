// ──────────────────────────────────────────────────────────
// API Provider — Clean rewrite with retry, chunking, fallback
// ──────────────────────────────────────────────────────────

import axios from "axios";
import { config } from "../config.js";

// ──────────────────────────────────────────────────────────
// Public interface
// ──────────────────────────────────────────────────────────

export const apiProvider = {
  async analyzeText(text) {
    if (config.detectMode === "mock") {
      return mockDetect(text);
    }
    return detectWithProvider(text);
  },

  async analyzeImage(imageData) {
    if (config.detectMode === "mock") {
      return callMockImage(imageData);
    }
    try {
      return await callHuggingFaceImage(imageData);
    } catch (err) {
      console.warn("[provider] Image analysis failed:", err.message);
      return fallback("image_error", err.message);
    }
  },
};

// ──────────────────────────────────────────────────────────
// Core detection — retry + chunking
// ──────────────────────────────────────────────────────────

/**
 * detectWithProvider(text)
 *
 * 1. Sanitize input
 * 2. If short enough → single call with retry
 * 3. If long → chunk into maxChunkSize blocks, call each, average scores
 * 4. Never throws — always returns a result
 */
async function detectWithProvider(text) {
  // Sanitize
  const clean = sanitize(text);
  if (!clean || clean.length < 20) {
    return fallback("empty_input", "Text too short or empty");
  }

  // Chunk if needed
  const chunks = chunkText(clean, config.maxChunkSize);
  console.log(
    `[provider] Analyzing ${chunks.length} chunk(s), total ${clean.length} chars`,
  );

  const results = [];

  for (const chunk of chunks) {
    const result = await callWithRetry(chunk);
    results.push(result);
  }

  // Average scores
  if (results.length === 0) {
    return fallback("no_results", "No chunks produced results");
  }

  const avgScore =
    results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const provider = results[0].provider;

  return {
    score: avgScore,
    provider,
    details: {
      chunks: results.length,
      chunkScores: results.map((r) => r.score),
    },
  };
}

// ──────────────────────────────────────────────────────────
// Retry with exponential backoff
// ──────────────────────────────────────────────────────────

async function callWithRetry(text) {
  const maxRetries = config.maxRetries;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callProvider(text);
    } catch (err) {
      const isLast = attempt === maxRetries;
      const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s

      if (isLast) {
        console.error(
          `[provider] All ${maxRetries + 1} attempts failed: ${err.message}`,
        );
        return fallback("all_retries_failed", err.message);
      }

      console.warn(
        `[provider] Attempt ${attempt + 1} failed (${err.message}), retrying in ${delay}ms...`,
      );
      await sleep(delay);
    }
  }

  return fallback("unexpected", "Retry loop exited unexpectedly");
}

// ──────────────────────────────────────────────────────────
// Provider dispatcher
// ──────────────────────────────────────────────────────────

async function callProvider(text) {
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
      console.warn(`[provider] Unknown API "${apiName}"`);
      return fallback("unknown_provider", `No provider named "${apiName}"`);
  }
}

// ──────────────────────────────────────────────────────────
// HuggingFace — primary provider
// ──────────────────────────────────────────────────────────

async function callHuggingFace(text) {
  const apiKey = config.huggingfaceApiKey;
  const model = "openai-community/roberta-base-openai-detector";

  const response = await axios.post(
    `https://router.huggingface.co/hf-inference/models/${model}`,
    { inputs: text.slice(0, 1024) },
    {
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      timeout: config.apiTimeout,
    },
  );

  const predictions = response.data?.[0] || [];
  const fakeScore = predictions.find((p) => p.label === "Fake")?.score ?? 0;

  return {
    score: fakeScore,
    provider: "huggingface",
    details: { predictions },
  };
}

// ──────────────────────────────────────────────────────────
// GPTZero
// ──────────────────────────────────────────────────────────

async function callGptZero(text) {
  const apiKey = config.gptZeroApiKey;
  if (!apiKey) return fallback("no_api_key", "GPTZero API key not configured");

  const response = await axios.post(
    "https://api.gptzero.me/v2/predict/text",
    { document: text },
    {
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      timeout: config.apiTimeout,
    },
  );

  const score = response.data?.documents?.[0]?.completely_generated_prob ?? 0;
  return {
    score,
    provider: "gptzero",
    details: {
      sentences: response.data?.documents?.[0]?.sentences?.map((s) => ({
        text: s.sentence,
        score: s.generated_prob,
      })),
    },
  };
}

// ──────────────────────────────────────────────────────────
// Sapling
// ──────────────────────────────────────────────────────────

async function callSapling(text) {
  const apiKey = config.saplingApiKey;
  if (!apiKey) return fallback("no_api_key", "Sapling API key not configured");

  const response = await axios.post(
    "https://api.sapling.ai/api/v1/aidetect",
    { key: apiKey, text },
    { timeout: config.apiTimeout },
  );

  return {
    score: response.data?.score ?? 0,
    provider: "sapling",
    details: { sentence_scores: response.data?.sentence_scores },
  };
}

// ──────────────────────────────────────────────────────────
// Originality
// ──────────────────────────────────────────────────────────

async function callOriginality(text) {
  const apiKey = config.originalityApiKey;
  if (!apiKey)
    return fallback("no_api_key", "Originality API key not configured");

  const response = await axios.post(
    "https://api.originality.ai/api/v1/scan/ai",
    { content: text },
    {
      headers: { "Content-Type": "application/json", "X-OAI-API-KEY": apiKey },
      timeout: config.apiTimeout,
    },
  );

  return {
    score: response.data?.score?.ai ?? 0,
    provider: "originality",
    details: response.data,
  };
}

// ──────────────────────────────────────────────────────────
// HuggingFace Image
// ──────────────────────────────────────────────────────────

async function callHuggingFaceImage(imageData) {
  const apiKey = config.huggingfaceApiKey;
  const model = "umm-maybe/AI-image-detector";

  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");

  const response = await axios.post(
    `https://router.huggingface.co/hf-inference/models/${model}`,
    buffer,
    {
      headers: {
        "Content-Type": "application/octet-stream",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      timeout: config.apiTimeout,
    },
  );

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
}

// ──────────────────────────────────────────────────────────
// Mock Provider — Deterministic with exact ranges
// ──────────────────────────────────────────────────────────

function mockDetect(text) {
  const flaggedRanges = [];
  const sentenceRegex = /[^.!?]+[.!?]+/g;
  let match;
  let count = 0;
  let lastIndex = 0;

  // Mark every 3rd sentence
  while ((match = sentenceRegex.exec(text)) !== null) {
    count++;
    if (count % 3 === 0) {
      flaggedRanges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    lastIndex = sentenceRegex.lastIndex;
  }

  // Handle trailing text
  const trailing = text.substring(lastIndex);
  if (trailing.trim().length > 0) {
    count++;
    if (count % 3 === 0) {
      flaggedRanges.push({ start: lastIndex, end: text.length });
    }
  }

  // Fallback: if very short text and no ranges flagged, flag the whole thing
  // just so we have something to test highlight/blur on.
  if (flaggedRanges.length === 0 && text.trim().length > 0) {
    flaggedRanges.push({ start: 0, end: text.length });
  }

  // Deterministic slightly randomized score (0.40 - 0.89) based on text length
  const score = 0.4 + (Math.sin(text.length) * 0.5 + 0.5) * 0.49;

  console.log(
    `[provider] mockDetect generated ${flaggedRanges.length} ranges for ${text.length} chars`,
  );

  return {
    score,
    provider: "mock",
    flaggedRanges,
  };
}

function callMockImage(imageData) {
  // Deterministic score based on image string length
  const len = imageData?.length || 0;
  const isAi = len % 2 === 0;
  const score = isAi ? 0.75 + (len % 20) / 100 : 0.15 + (len % 10) / 100;

  return {
    score,
    provider: "mock-image",
  };
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function sanitize(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\s+/g, " ") // collapse whitespace
    .replace(/\n+/g, " ") // collapse newlines
    .trim()
    .slice(0, config.maxInputLength);
}

function chunkText(text, maxSize) {
  if (text.length <= maxSize) return [text];

  const chunks = [];
  // Try to split on sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

function fallback(reason, detail) {
  return {
    score: 0,
    provider: "fallback",
    reason,
    details: { note: detail },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
