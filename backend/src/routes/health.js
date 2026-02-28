// ──────────────────────────────────────────────────────────
// Health Route — GET /health
// ──────────────────────────────────────────────────────────

import { Router } from "express";
import { config } from "../config.js";
import { getMetrics } from "../utils/metrics.js";
import { cache } from "../utils/cache.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const metrics = getMetrics();
  res.json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    provider: config.detectProvider,
    apiProvider: config.apiProviderName,
    cache: {
      size: cache.size,
      maxSize: config.cacheMaxSize,
    },
    metrics,
    timestamp: new Date().toISOString(),
  });
});
