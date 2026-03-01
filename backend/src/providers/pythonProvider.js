import axios from "axios";
import { config } from "../config.js";

const DEFAULT_TIMEOUT_MS = 30000;

export const pythonProvider = {
  /**
   * Forward text analysis to the Python model service.
   * @param {string} text
   * @returns {Promise<{score:number, provider:string, details?:object}>}
   */
  async analyzeText(text) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/text`,
        { text },
        {
          headers: { "Content-Type": "application/json" },
          timeout: DEFAULT_TIMEOUT_MS,
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: response.data.provider ?? "python-model",
        details: response.data.details ?? {},
        latency_ms: response.data.latency_ms,
      };
    } catch (err) {
      console.error("[pythonProvider] Model service text error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },

  /**
   * Forward single-image analysis to the Python model service.
   * @param {string} imageData
   * @returns {Promise<{score:number, provider:string, details?:object}>}
   */
  async analyzeImage(imageData) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/image`,
        { image: imageData },
        {
          headers: { "Content-Type": "application/json" },
          timeout: DEFAULT_TIMEOUT_MS,
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: response.data.provider ?? "python-model",
        details: response.data.details ?? {},
        latency_ms: response.data.latency_ms,
      };
    } catch (err) {
      console.error("[pythonProvider] Model service image error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },

  /**
   * Forward chunked text analysis to the Python model service.
   * @param {Array<{id:string,text:string,kind?:string,start_char?:number,end_char?:number}>} chunks
   * @returns {Promise<{score:number, provider:string, details?:object}>}
   */
  async analyzeTextSpans(chunks) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/text/spans`,
        { chunks },
        {
          headers: { "Content-Type": "application/json" },
          timeout: DEFAULT_TIMEOUT_MS,
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: response.data.provider ?? "python-model",
        details: response.data.details ?? {},
        latency_ms: response.data.latency_ms,
      };
    } catch (err) {
      console.error("[pythonProvider] Model service text/spans error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },

  /**
   * Forward image batch analysis to the Python model service.
   * @param {Array<{id:string,image:string}>} images
   * @returns {Promise<{score:number, provider:string, details?:object}>}
   */
  async analyzeImageBatch(images) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/image/batch`,
        { images },
        {
          headers: { "Content-Type": "application/json" },
          timeout: DEFAULT_TIMEOUT_MS,
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: response.data.provider ?? "python-model",
        details: response.data.details ?? {},
        latency_ms: response.data.latency_ms,
      };
    } catch (err) {
      console.error("[pythonProvider] Model service image/batch error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },

  /**
   * Forward page-level analysis to the Python model service.
   * @param {{chunks?:Array<object>, images?:Array<object>}} payload
   * @returns {Promise<{score:number, provider:string, details?:object}>}
   */
  async analyzePage(payload) {
    try {
      const response = await axios.post(
        `${config.modelServiceUrl}/infer/page`,
        payload,
        {
          headers: { "Content-Type": "application/json" },
          timeout: DEFAULT_TIMEOUT_MS,
        },
      );

      return {
        score: response.data.score ?? 0,
        provider: response.data.provider ?? "python-model",
        details: response.data.details ?? {},
        latency_ms: response.data.latency_ms,
      };
    } catch (err) {
      console.error("[pythonProvider] Model service page error:", err.message);
      throw new Error(`Python model service unavailable: ${err.message}`);
    }
  },
};