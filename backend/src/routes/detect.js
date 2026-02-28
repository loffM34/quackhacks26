// ──────────────────────────────────────────────────────────
// Detection Routes — /detect/text and /detect/image
// ──────────────────────────────────────────────────────────

import { Router } from "express";
import { detectService } from "../services/detectService.js";
import { cache } from "../utils/cache.js";
import { trackLatency } from "../utils/metrics.js";
import { config } from "../config.js";
import { logger } from "../index.js";
import crypto from "crypto";

export const detectRouter = Router();

/**
 * POST /detect/text
 * Body: { text: string, url?: string }
 * Response: { score: number, provider: string, details?: object, cached: boolean }
 */
detectRouter.post("/text", async (req, res) => {
  const start = Date.now();

  try {
    const { text, url } = req.body;

    // Validate input
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }

    // Truncate to max length
    const truncated = text.slice(0, config.maxTextLength);

    // Check cache
    const cacheKey = `text:${hashContent(truncated)}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (text)");
      trackLatency("text", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    // Call detection service
    const result = await detectService.analyzeText(truncated);

    // Cache result
    cache.set(cacheKey, result);

    // Log (only hash + score, not raw content for privacy)
    logger.info(
      {
        type: "text",
        score: result.score,
        provider: result.provider,
        textHash: cacheKey.slice(0, 20),
        latencyMs: Date.now() - start,
      },
      "Detection result",
    );

    trackLatency("text", Date.now() - start, false);
    return res.json({ ...result, cached: false });
  } catch (err) {
    logger.error(err, "Error in /detect/text");
    trackLatency("text", Date.now() - start, false);
    return res.status(500).json({ error: "Detection failed" });
  }
});

/**
 * POST /detect/image
 * Body: { image: string } — base64 data URI or URL
 * Response: { score: number, provider: string, details?: object, cached: boolean }
 */
detectRouter.post("/image", async (req, res) => {
  const start = Date.now();

  try {
    const { image } = req.body;

    // Validate input
    if (!image || typeof image !== "string") {
      return res
        .status(400)
        .json({ error: 'Missing or invalid "image" field' });
    }

    // Size check for base64
    if (image.length > config.maxImageSizeBytes * 1.37) {
      // base64 overhead
      return res.status(400).json({ error: "Image too large (max 2MB)" });
    }

    // Check cache
    const cacheKey = `img:${hashContent(image.slice(0, 500))}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (image)");
      trackLatency("image", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    // Call detection service
    const result = await detectService.analyzeImage(image);

    // Cache result
    cache.set(cacheKey, result);

    logger.info(
      {
        type: "image",
        score: result.score,
        provider: result.provider,
        latencyMs: Date.now() - start,
      },
      "Detection result",
    );

    trackLatency("image", Date.now() - start, false);
    return res.json({ ...result, cached: false });
  } catch (err) {
    logger.error(err, "Error in /detect/image");
    trackLatency("image", Date.now() - start, false);
    return res.status(500).json({ error: "Detection failed" });
  }
});

// ── Helpers ──

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
