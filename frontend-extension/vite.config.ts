import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Multi-entry Vite config for Chrome Extension MV3
// Builds: content script, background service worker, popup, and sidepanel
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // React popup & sidepanel pages
        popup: resolve(__dirname, "popup.html"),
        sidepanel: resolve(__dirname, "sidepanel.html"),
        // Content script — injected into web pages
        contentScript: resolve(__dirname, "src/contentScript.ts"),
        // Background service worker
        background: resolve(__dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          // Keep content script and background at root level for manifest references
          if (chunkInfo.name === "contentScript") return "contentScript.js";
          if (chunkInfo.name === "background") return "background.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    // Don't minify for easier debugging during hackathon
    minify: false,
    sourcemap: true,
  },
  // Resolve aliases
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
