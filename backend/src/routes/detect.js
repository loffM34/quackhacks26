// ──────────────────────────────────────────────────────────
// Detection Routes
// ──────────────────────────────────────────────────────────

import { Router } from "express";
import crypto from "crypto";

import { detectService } from "../services/detectService.js";
import { cache } from "../utils/cache.js";
import { trackLatency } from "../utils/metrics.js";
import { config } from "../config.js";
import { logger } from "../index.js";

export const detectRouter = Router();

/**
 * POST /detect/text
 * Body: { text: string, url?: string }
 */
detectRouter.post("/text", async (req, res) => {
  const start = Date.now();

  try {
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }

    const truncated = text.slice(0, config.maxTextLength);
    const cacheKey = `text:${hashContent(truncated)}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (text)");
      trackLatency("text", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    const result = await detectService.analyzeText(truncated);
    cache.set(cacheKey, result);

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
 * Body: { image: string }
 */
detectRouter.post("/image", async (req, res) => {
  const start = Date.now();

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
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (image)");
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
    return res.status(500).json({ error: "Detection failed" });
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
        kind: typeof chunk.kind === "string" ? chunk.kind : "block",
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
            kind: typeof chunk.kind === "string" ? chunk.kind : "block",
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

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}