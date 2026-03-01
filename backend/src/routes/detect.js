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

detectRouter.post("/text", async (req, res) => {
  const start = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";

  // Per-IP rate check
  if (config.detectMode !== "mock" && !checkIpRate(clientIp)) {
    logger.warn({ ip: clientIp }, "Rate limited");
    return res.status(429).json({
      error: "Too many requests. Max 5 per 10 seconds.",
      score: 0,
      provider: "rate_limited",
    });
  }

  try {
    const { text, url } = req.body;

    // Validate
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: 'Missing or invalid "text" field' });
    }

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
    const cached = cache.get(cacheKey);
    if (cached) {
      logger.info({ cacheKey: cacheKey.slice(0, 20) }, "Cache hit (text)");
      trackLatency("text", Date.now() - start, true);
      return res.json({ ...cached, cached: true });
    }

    // Call detection
    const result = await detectService.analyzeText(sanitized);

    // Cache result
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

// ──────────────────────────────────────────────────────────
// POST /detect/image
// ──────────────────────────────────────────────────────────

detectRouter.post("/image", async (req, res) => {
  const start = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";

  if (config.detectMode !== "mock" && !checkIpRate(clientIp)) {
    return res.status(429).json({
      error: "Too many requests.",
      score: 0,
      provider: "rate_limited",
    });
  }

  try {
    const { image } = req.body;

    if (!image || typeof image !== "string") {
      return res
        .status(400)
        .json({ error: 'Missing or invalid "image" field' });
    }

    if (image.length > config.maxImageSizeBytes * 1.37) {
      return res.status(400).json({ error: "Image too large (max 2MB)" });
    }

    // Check cache
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

// ── Helpers ──

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}
