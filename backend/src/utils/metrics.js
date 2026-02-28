// ──────────────────────────────────────────────────────────
// Metrics — simple latency and usage tracking
// ──────────────────────────────────────────────────────────

const metrics = {
  text: { requests: 0, totalLatencyMs: 0, cacheHits: 0 },
  image: { requests: 0, totalLatencyMs: 0, cacheHits: 0 },
};

/**
 * Track a detection request's latency and cache status.
 */
export function trackLatency(type, latencyMs, cached) {
  const m = metrics[type];
  if (!m) return;
  m.requests++;
  m.totalLatencyMs += latencyMs;
  if (cached) m.cacheHits++;
}

/**
 * Get current metrics snapshot.
 */
export function getMetrics() {
  return {
    text: {
      ...metrics.text,
      avgLatencyMs: metrics.text.requests
        ? Math.round(metrics.text.totalLatencyMs / metrics.text.requests)
        : 0,
      cacheHitRate: metrics.text.requests
        ? Math.round((metrics.text.cacheHits / metrics.text.requests) * 100)
        : 0,
    },
    image: {
      ...metrics.image,
      avgLatencyMs: metrics.image.requests
        ? Math.round(metrics.image.totalLatencyMs / metrics.image.requests)
        : 0,
      cacheHitRate: metrics.image.requests
        ? Math.round((metrics.image.cacheHits / metrics.image.requests) * 100)
        : 0,
    },
  };
}
