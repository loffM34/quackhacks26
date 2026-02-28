// ──────────────────────────────────────────────────────────
// Backend Gateway — AI Content Shield
// ──────────────────────────────────────────────────────────
// Express server that proxies detection requests to the active
// provider (external API or local Python model service).
// Includes security headers, rate limiting, CORS, and caching.

import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import { config } from "./config.js";
import { detectRouter } from "./routes/detect.js";
import { healthRouter } from "./routes/health.js";

// ── Logger ──
export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

// ── Express app ──
const app = express();

// ── Security middleware ──
app.use(helmet());

// ── CORS — only allow extension origin ──
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests from Chrome extensions and configured origins
      if (
        !origin || // allow non-browser requests (e.g., health checks)
        origin.startsWith("chrome-extension://") ||
        config.allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("CORS: origin not allowed"));
      }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  }),
);

// ── Rate limiting — protect third-party API quotas ──
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.rateLimitPerMinute,
  message: { error: "Too many requests. Please wait before retrying." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── Body parsing ──
app.use(express.json({ limit: "5mb" })); // allow base64 image uploads

// ── Request logging ──
app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path }, "Request");
  next();
});

// ── Routes ──
app.use("/detect", detectRouter);
app.use("/", healthRouter);

// ── Error handler ──
app.use((err, _req, res, _next) => {
  logger.error(err, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// ── Start server ──
app.listen(config.port, () => {
  logger.info(
    `🛡️ AI Content Shield backend running on port ${config.port} (provider: ${config.detectProvider})`,
  );
});

export default app;
