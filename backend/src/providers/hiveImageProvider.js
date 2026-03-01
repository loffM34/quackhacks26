// ──────────────────────────────────────────────────────────
// Hive Image Provider — AI-Generated Image Detection via NVIDIA NIM
// ──────────────────────────────────────────────────────────

import axios from "axios";
import { config } from "../config.js";

const HIVE_ENDPOINT =
  "https://ai.api.nvidia.com/v1/cv/hive/ai-generated-image-detection";

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Analyze a single image using the Hive AI-Generated Image Detection model.
 * Accepts a base64-encoded image string (with or without data URI prefix).
 *
 * @param {string} imageData — base64 image (data:image/jpeg;base64,... or raw base64)
 * @returns {Promise<{score: number, provider: string, details: object}>}
 */
export async function analyzeImageWithHive(imageData) {
  const apiKey = config.hiveApiKey;
  if (!apiKey) {
    console.warn("[hiveImageProvider] No HIVE_API_KEY configured — skipping.");
    return {
      score: 0,
      provider: "hive-skipped",
      details: { reason: "no_api_key" },
    };
  }

  // Ensure we have a proper data URI
  let dataUri = imageData;
  if (!dataUri.startsWith("data:")) {
    dataUri = `data:image/jpeg;base64,${dataUri}`;
  }

  try {
    const response = await axios.post(
      HIVE_ENDPOINT,
      { input: [dataUri] },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        timeout: DEFAULT_TIMEOUT_MS,
      },
    );

    // Parse the Hive response
    const data = response.data?.data?.[0] ?? response.data;

    // The top-level "is_ai_generated" score
    const isAiGenerated = data?.is_ai_generated ?? data?.score ?? 0;

    // Per-source breakdown (midjourney, dalle, etc.)
    const possibleSources = data?.possible_sources ?? {};

    // Find the top source
    let topSource = "unknown";
    let topSourceScore = 0;
    for (const [source, score] of Object.entries(possibleSources)) {
      if (typeof score === "number" && score > topSourceScore) {
        topSource = source;
        topSourceScore = score;
      }
    }

    return {
      score: isAiGenerated,
      provider: "hive",
      details: {
        is_ai_generated: isAiGenerated,
        top_source: topSource,
        top_source_score: topSourceScore,
        possible_sources: possibleSources,
      },
    };
  } catch (err) {
    console.error("[hiveImageProvider] API error:", err.message);
    if (err.response) {
      console.error("[hiveImageProvider] Status:", err.response.status);
      console.error(
        "[hiveImageProvider] Body:",
        JSON.stringify(err.response.data).slice(0, 500),
      );
    }
    return {
      score: 0,
      provider: "hive-error",
      details: { error: err.message },
    };
  }
}

/**
 * Analyze a batch of images. Calls Hive sequentially for each image
 * and returns aggregated results.
 *
 * @param {Array<{id: string, image: string}>} images
 * @returns {Promise<{score: number, provider: string, details: object}>}
 */
export async function analyzeImageBatchWithHive(images) {
  if (!images || images.length === 0) {
    return { score: 0, provider: "hive", details: { results: [] } };
  }

  const results = [];

  for (const item of images) {
    const result = await analyzeImageWithHive(item.image);
    results.push({
      id: item.id,
      score: result.score,
      tier:
        result.score >= 0.8 ? "high" : result.score >= 0.6 ? "medium" : "low",
      explanation: result.details?.top_source
        ? `Top source: ${result.details.top_source} (${Math.round(result.details.top_source_score * 100)}%)`
        : null,
      ...result.details,
    });
  }

  // Overall score = average of individual scores
  const avgScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;

  return {
    score: avgScore,
    provider: "hive",
    details: { results },
  };
}

export const hiveImageProvider = {
  analyzeImage: analyzeImageWithHive,
  analyzeImageBatch: analyzeImageBatchWithHive,
};
