// ──────────────────────────────────────────────────────────
// Python Provider — Local FastAPI Model Service
// ──────────────────────────────────────────────────────────
// Forwards detection requests to a local Python FastAPI server
// running HuggingFace/PyTorch models.
//
// To activate: set DETECT_PROVIDER=python and MODEL_SERVICE_URL
// in your .env file. Then start the FastAPI service.

import axios from "axios";
import { config } from "../config.js";

export const pythonProvider = {
  /**
   * Forward text analysis to the Python model service.
   * @param text — text to analyze
   * @returns { score: 0–1, provider: string, details?: object }
   */
  async analyzeText(text) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/text`,
        { text },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30000, // models may be slower than APIs
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: "python-model",
        details: response.data.details ?? {},
      };
    } catch (err) {
      console.error("[pythonProvider] Model service error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },

  /**
   * Forward image analysis to the Python model service.
   * @param imageData — base64 data URI
   * @returns { score: 0–1, provider: string, details?: object }
   */
  async analyzeImage(imageData) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/image`,
        { image: imageData },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: "python-model",
        details: response.data.details ?? {},
      };
    } catch (err) {
      console.error("[pythonProvider] Model service image error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },
};
