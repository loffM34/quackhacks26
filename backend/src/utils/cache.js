// ──────────────────────────────────────────────────────────
// LRU Cache — in-memory caching for detection results
// ──────────────────────────────────────────────────────────

import { LRUCache } from "lru-cache";
import { config } from "../config.js";

export const cache = new LRUCache({
  max: config.cacheMaxSize, // max entries (default 500)
  ttl: config.cacheTtlMs, // TTL in ms (default 10 minutes)
  updateAgeOnGet: true, // refresh TTL on cache hit
  allowStale: false,
});
