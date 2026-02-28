// ──────────────────────────────────────────────────────────
// Image Compressor — resizes and compresses images for upload
// ──────────────────────────────────────────────────────────
// Compresses images to ≤800px longest edge, outputs as base64 JPEG.
// Runs entirely in-browser using OffscreenCanvas or <canvas>.

/** Maximum dimension (longest edge) for compressed images */
const MAX_DIMENSION = 800;
/** JPEG quality for compression (0–1) */
const JPEG_QUALITY = 0.7;

/**
 * Compress an image from a URL to a base64 JPEG string.
 * Resizes so the longest edge is ≤ MAX_DIMENSION pixels.
 *
 * @param imageUrl - URL of the image to compress (same-origin or CORS-enabled)
 * @returns base64-encoded JPEG data URI, or null if compression fails
 */
export async function compressImage(imageUrl: string): Promise<string | null> {
  try {
    // Load image into an HTMLImageElement
    const img = await loadImage(imageUrl);

    // Calculate new dimensions
    const { width, height } = calculateDimensions(
      img.naturalWidth,
      img.naturalHeight,
      MAX_DIMENSION,
    );

    // Draw to canvas and export as JPEG
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, width, height);

    // Convert to base64 JPEG
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return dataUrl;
  } catch (err) {
    console.warn("[AI Shield] Failed to compress image:", imageUrl, err);
    return null;
  }
}

/**
 * Compress multiple images in parallel.
 * Skips any that fail compression.
 */
export async function compressImages(imageUrls: string[]): Promise<string[]> {
  const results = await Promise.allSettled(
    imageUrls.map((url) => compressImage(url)),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<string> =>
        r.status === "fulfilled" && r.value !== null,
    )
    .map((r) => r.value);
}

/** Load an image URL into an HTMLImageElement */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // needed for CORS images
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/** Calculate new dimensions while preserving aspect ratio */
function calculateDimensions(
  origWidth: number,
  origHeight: number,
  maxDim: number,
): { width: number; height: number } {
  if (origWidth <= maxDim && origHeight <= maxDim) {
    return { width: origWidth, height: origHeight };
  }

  const ratio = Math.min(maxDim / origWidth, maxDim / origHeight);
  return {
    width: Math.round(origWidth * ratio),
    height: Math.round(origHeight * ratio),
  };
}
