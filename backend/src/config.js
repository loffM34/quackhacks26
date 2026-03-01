// ──────────────────────────────────────────────────────────
// Config — centralized environment variable loading
// ──────────────────────────────────────────────────────────

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",

  // ── Provider selection ──
  // NEW: "mock" or "api" modes. Mock bypasses HF completely.
  detectMode: process.env.DETECTION_MODE || "mock",
  detectProvider: process.env.DETECT_PROVIDER || "api",

  // ── External API keys ──
  gptZeroApiKey: process.env.GPTZERO_API_KEY || "",
  originalityApiKey: process.env.ORIGINALITY_API_KEY || "",
  saplingApiKey: process.env.SAPLING_API_KEY || "",
  huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || "",
  hiveApiKey: process.env.NVIDIA_API_KEY || "",

  // ── Python model service URL ──
  modelServiceUrl: process.env.MODEL_SERVICE_URL || "http://localhost:8000",

  // ── Cache settings ──
  cacheTtlMs: parseInt(process.env.CACHE_TTL_MS || "600000", 10),
  cacheMaxSize: parseInt(process.env.CACHE_MAX_SIZE || "500", 10),

  // ── Rate limiting ──
  rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || "30", 10),

  // ── CORS ──
  allowedOrigins: (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .filter(Boolean),

  // ── Content limits ──
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || "5000", 10),
  maxImageSizeBytes: parseInt(process.env.MAX_IMAGE_SIZE || "2097152", 10),

  // ── Chunking & retry (NEW) ──
  maxInputLength: 2000, // max chars accepted from client
  maxChunkSize: 1000, // chars per chunk sent to HuggingFace
  apiTimeout: 30000, // axios timeout in ms
  maxRetries: 2, // retry attempts with exponential backoff
};
