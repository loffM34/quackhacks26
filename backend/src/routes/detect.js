// ──────────────────────────────────────────────────────────
// Detection Routes — /detect/text, /detect/image, /detect/text/spans,
// /detect/image/batch, /detect/page
// ──────────────────────────────────────────────────────────

import { Router } from "express";
import crypto from "crypto";

import { detectService } from "../services/detectService.js";
import { cache } from "../utils/cache.js";
import { trackLatency } from "../utils/metrics.js";
import { config } from "../config.js";
import { logger } from "../index.js";

export const detectRouter = Router();

<<<<<<< HEAD
/**
 * POST /detect/text
 * Body: { text: string, url?: string }
 */
=======
// ──────────────────────────────────────────────────────────
// Per-IP rate limiter — 5 requests per 10 seconds
// ──────────────────────────────────────────────────────────

const ipHits = new Map();
const IP_WINDOW_MS = 10_000;
const IP_MAX_HITS = 5;

function checkIpRate(ip) {
  const now = Date.now();
  const entry = ipHits.get(ip);

  if (!entry || now - entry.windowStart > IP_WINDOW_MS) {
    ipHits.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  entry.count++;
  if (entry.count > IP_MAX_HITS) return false;
  return true;
}

// Clean up stale entries every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now - entry.windowStart > IP_WINDOW_MS * 2) ipHits.delete(ip);
  }
}, 30_000);

// ──────────────────────────────────────────────────────────
// POST /detect/text
// ──────────────────────────────────────────────────────────

>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
detectRouter.post("/text", async (req, res) => {
  const start = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";

  // Per-IP rate check
  if (!checkIpRate(clientIp)) {
    logger.warn({ ip: clientIp }, "Rate limited");
    return res.status(429).json({
      error: "Too many requests. Max 5 per 10 seconds.",
      score: 0,
      provider: "rate_limited",
    });
  }

  try {
    const { text } = req.body;

<<<<<<< HEAD
=======
    // Validate
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }

<<<<<<< HEAD
    const truncated = text.slice(0, config.maxTextLength);
    const cacheKey = `text:${hashContent(truncated)}`;
=======
    // Sanitize: collapse whitespace, enforce max length
    const sanitized = text
      .replace(/\s+/g, " ")
      .replace(/\n+/g, " ")
      .trim()
      .slice(0, config.maxInputLength);

    if (sanitized.length < 20) {
      return res.json({
        score: 0,
        provider: "skipped",
        reason: "text_too_short",
        cached: false,
      });
    }

    // Check cache
    const cacheKey = `text:${hashContent(sanitized)}`;
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
    const cached = cache.get(cacheKey);

    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (text)");
      trackLatency("text", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

<<<<<<< HEAD
    const result = await detectService.analyzeText(truncated);
=======
    // Call detection
    const result = await detectService.analyzeText(sanitized);

    // Cache result
>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
    cache.set(cacheKey, result);

    logger.info(
      {
        type: "text",
        score: result.score,
        provider: result.provider,
        chars: sanitized.length,
        latencyMs: Date.now() - start,
      },
      "Detection result",
    );

    trackLatency("text", Date.now() - start, false);
    return res.json({ ...result, cached: false });
  } catch (err) {
    logger.error(err, "Error in /detect/text");
    trackLatency("text", Date.now() - start, false);
    // Never crash — return fallback
    return res.json({
      score: 0,
      provider: "fallback",
      reason: "server_error",
      error: err.message,
      cached: false,
    });
  }
});

<<<<<<< HEAD
/**
 * POST /detect/image
 * Body: { image: string }
 */
=======
// ──────────────────────────────────────────────────────────
// POST /detect/image
// ──────────────────────────────────────────────────────────

>>>>>>> 4516d22a78a0a5300ab4466485ba584dc0640864
detectRouter.post("/image", async (req, res) => {
  const start = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";

  if (!checkIpRate(clientIp)) {
    return res.status(429).json({
      error: "Too many requests.",
      score: 0,
      provider: "rate_limited",
    });
  }

  try {
    const { image } = req.body;

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: 'Missing or invalid "image" field' });
    }

    if (image.length > config.maxImageSizeBytes * 1.37) {
      return res.status(400).json({ error: "Image too large (max 2MB)" });
    }

    const cacheKey = `img:${hashContent(image.slice(0, 500))}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      trackLatency("image", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    const result = await detectService.analyzeImage(image);
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
    return res.json({
      score: 0,
      provider: "fallback",
      reason: "image_error",
      error: err.message,
      cached: false,
    });
  }
});

/**
 * POST /detect/text/spans
 * Body: { chunks: [{ id, text, kind?, start_char?, end_char? }] }
 */
detectRouter.post("/text/spans", async (req, res) => {
  const start = Date.now();

  try {
    const { chunks } = req.body;

    if (!Array.isArray(chunks) || chunks.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid "chunks" array' });
    }

    const normalizedChunks = chunks
      .filter((chunk) => chunk && typeof chunk.id === "string" && typeof chunk.text === "string")
      .map((chunk) => ({
        id: chunk.id,
        text: chunk.text.slice(0, config.maxTextLength),
        kind: typeof chunk.kind === "string" ? chunk.kind : "sentence",
        start_char: Number.isInteger(chunk.start_char) ? chunk.start_char : undefined,
        end_char: Number.isInteger(chunk.end_char) ? chunk.end_char : undefined,
      }));

    if (normalizedChunks.length === 0) {
      return res.status(400).json({ error: "No valid text chunks provided" });
    }

    const cacheKey = `textspans:${hashContent(
      JSON.stringify(normalizedChunks.map((c) => [c.id, c.text])),
    )}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (text/spans)");
      trackLatency("text_spans", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    const result = await detectService.analyzeTextSpans(normalizedChunks);
    cache.set(cacheKey, result);

    logger.info(
      {
        type: "text/spans",
        score: result.score,
        provider: result.provider,
        chunkCount: normalizedChunks.length,
        textHash: cacheKey.slice(0, 20),
        latencyMs: Date.now() - start,
      },
      "Detection result",
    );

    trackLatency("text_spans", Date.now() - start, false);
    return res.json({ ...result, cached: false });
  } catch (err) {
    logger.error(err, "Error in /detect/text/spans");
    trackLatency("text_spans", Date.now() - start, false);
    return res.status(500).json({ error: "Detection failed" });
  }
});

/**
 * POST /detect/image/batch
 * Body: { images: [{ id, image }] }
 */
detectRouter.post("/image/batch", async (req, res) => {
  const start = Date.now();

  try {
    const { images } = req.body;

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid "images" array' });
    }

    const normalizedImages = images
      .filter((item) => item && typeof item.id === "string" && typeof item.image === "string")
      .map((item) => ({
        id: item.id,
        image: item.image,
      }));

    if (normalizedImages.length === 0) {
      return res.status(400).json({ error: "No valid images provided" });
    }

    for (const item of normalizedImages) {
      if (item.image.length > config.maxImageSizeBytes * 1.37) {
        return res.status(400).json({
          error: `Image too large (max 2MB): ${item.id}`,
        });
      }
    }

    const cacheKey = `imgbatch:${hashContent(
      JSON.stringify(normalizedImages.map((img) => [img.id, img.image.slice(0, 500)])),
    )}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (image/batch)");
      trackLatency("image_batch", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    const result = await detectService.analyzeImageBatch(normalizedImages);
    cache.set(cacheKey, result);

    logger.info(
      {
        type: "image/batch",
        score: result.score,
        provider: result.provider,
        imageCount: normalizedImages.length,
        latencyMs: Date.now() - start,
      },
      "Detection result",
    );

    trackLatency("image_batch", Date.now() - start, false);
    return res.json({ ...result, cached: false });
  } catch (err) {
    logger.error(err, "Error in /detect/image/batch");
    trackLatency("image_batch", Date.now() - start, false);
    return res.status(500).json({ error: "Detection failed" });
  }
});

/**
 * POST /detect/page
 * Body: { chunks?: [...], images?: [...] }
 */
detectRouter.post("/page", async (req, res) => {
  const start = Date.now();

  try {
    const { chunks = [], images = [] } = req.body ?? {};

    if (!Array.isArray(chunks) && !Array.isArray(images)) {
      return res.status(400).json({ error: 'Body must include "chunks" and/or "images"' });
    }

    const normalizedChunks = Array.isArray(chunks)
      ? chunks
          .filter((chunk) => chunk && typeof chunk.id === "string" && typeof chunk.text === "string")
          .map((chunk) => ({
            id: chunk.id,
            text: chunk.text.slice(0, config.maxTextLength),
            kind: typeof chunk.kind === "string" ? chunk.kind : "sentence",
            start_char: Number.isInteger(chunk.start_char) ? chunk.start_char : undefined,
            end_char: Number.isInteger(chunk.end_char) ? chunk.end_char : undefined,
          }))
      : [];

    const normalizedImages = Array.isArray(images)
      ? images
          .filter((item) => item && typeof item.id === "string" && typeof item.image === "string")
          .map((item) => ({
            id: item.id,
            image: item.image,
          }))
      : [];

    if (normalizedChunks.length === 0 && normalizedImages.length === 0) {
      return res.status(400).json({ error: "No valid chunks or images provided" });
    }

    for (const item of normalizedImages) {
      if (item.image.length > config.maxImageSizeBytes * 1.37) {
        return res.status(400).json({
          error: `Image too large (max 2MB): ${item.id}`,
        });
      }
    }

    const cacheKey = `page:${hashContent(
      JSON.stringify({
        chunks: normalizedChunks.map((c) => [c.id, c.text]),
        images: normalizedImages.map((i) => [i.id, i.image.slice(0, 500)]),
      }),
    )}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (page)");
      trackLatency("page", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    const result = await detectService.analyzePage({
      chunks: normalizedChunks,
      images: normalizedImages,
    });
    cache.set(cacheKey, result);

    logger.info(
      {
        type: "page",
        score: result.score,
        provider: result.provider,
        chunkCount: normalizedChunks.length,
        imageCount: normalizedImages.length,
        latencyMs: Date.now() - start,
      },
      "Detection result",
    );

    trackLatency("page", Date.now() - start, false);
    return res.json({ ...result, cached: false });
  } catch (err) {
    logger.error(err, "Error in /detect/page");
    trackLatency("page", Date.now() - start, false);
    return res.status(500).json({ error: "Detection failed" });
  }
});

// ── Helpers ──
function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}