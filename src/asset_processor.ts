import sharp from "sharp";

export interface EncodedImage {
  base64: string;
  mime_type: string;
  width: number;
  height: number;
  original_width: number;
  original_height: number;
  quality: number;
}

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  format: string | null;
  size: number;
}

// Cache for encoded previews
const PREVIEW_CACHE = new Map<string, { encoded: EncodedImage; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const MAX_B64_CHARS = 100000; // ~100KB budget

/**
 * Generate a cache key from image bytes (simple hash of first/last bytes + length).
 */
function getCacheKey(imageBytes: Buffer): string {
  const len = imageBytes.length;
  const first = imageBytes.slice(0, 16).toString("hex");
  const last = imageBytes.slice(Math.max(0, len - 16)).toString("hex");
  return `${len}-${first}-${last}`;
}

/**
 * Encode an image for MCP preview with caching, budget enforcement, and
 * deterministic compression ladder (like Python version).
 */
export async function encodePreviewForMcp(
  imageBytes: Buffer,
  maxDim?: number,
  maxB64Chars: number = MAX_B64_CHARS,
): Promise<EncodedImage> {
  // Check cache first
  const cacheKey = getCacheKey(imageBytes);
  const cached = PREVIEW_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.encoded;
  }

  // Get original dimensions
  const originalMetadata = await sharp(imageBytes).metadata();
  const originalWidth = originalMetadata.width || 0;
  const originalHeight = originalMetadata.height || 0;

  // Compute target dimensions
  let targetWidth = originalWidth;
  let targetHeight = originalHeight;

  if (maxDim && (originalWidth > maxDim || originalHeight > maxDim)) {
    if (originalWidth >= originalHeight) {
      targetWidth = maxDim;
      targetHeight = Math.round(maxDim * (originalHeight / originalWidth));
    } else {
      targetHeight = maxDim;
      targetWidth = Math.round(maxDim * (originalWidth / originalHeight));
    }
  }

  // Deterministic compression ladder: quality [70, 55, 40] with downscale targets
  // Like Python: quality levels with corresponding max_dim targets
  const qualityLevels = [70, 55, 40];
  const downscaleTargets: Array<{ width: number; height: number } | null> = [
    maxDim ? { width: targetWidth, height: targetHeight } : null,
    { width: 384, height: Math.round(384 * (targetHeight / targetWidth)) },
    { width: 256, height: Math.round(256 * (targetHeight / targetWidth)) },
  ];

  for (let i = 0; i < qualityLevels.length; i++) {
    const quality = qualityLevels[i];
    const target = downscaleTargets[i];

    let resized = sharp(imageBytes);
    if (target) {
      resized = resized.resize({
        width: target.width,
        height: target.height,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const webpBuffer = await resized.webp({ quality }).toBuffer();
    const base64 = webpBuffer.toString("base64");

    if (base64.length <= maxB64Chars) {
      // Get actual dimensions from the output
      const outMeta = await sharp(webpBuffer).metadata();
      const result: EncodedImage = {
        base64,
        mime_type: "image/webp",
        width: outMeta.width || 0,
        height: outMeta.height || 0,
        original_width: originalWidth,
        original_height: originalHeight,
        quality,
      };

      // Cache the result
      PREVIEW_CACHE.set(cacheKey, { encoded: result, timestamp: Date.now() });

      // Limit cache size
      if (PREVIEW_CACHE.size > 50) {
        const firstKey = PREVIEW_CACHE.keys().next().value;
        if (firstKey) PREVIEW_CACHE.delete(firstKey);
      }

      return result;
    }
  }

  // Last resort: check if even the lowest quality + smallest size fits
  const lastResort = await sharp(imageBytes)
    .resize({
      width: 256,
      height: Math.round(256 * (targetHeight / targetWidth)),
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 40 })
    .toBuffer();
  const lastResortB64 = lastResort.toString("base64");

  if (lastResortB64.length > maxB64Chars) {
    throw new Error(
      `Image cannot be compressed within budget of ${maxB64Chars} characters. ` +
        `Base64 size: ${lastResortB64.length} chars at 256px/quality=40. ` +
        `Original: ${originalWidth}x${originalHeight}.`,
    );
  }

  const lastMeta = await sharp(lastResort).metadata();
  const result: EncodedImage = {
    base64: lastResortB64,
    mime_type: "image/webp",
    width: lastMeta.width || 0,
    height: lastMeta.height || 0,
    original_width: originalWidth,
    original_height: originalHeight,
    quality: 40,
  };

  PREVIEW_CACHE.set(cacheKey, { encoded: result, timestamp: Date.now() });
  return result;
}

/**
 * Get metadata from image bytes.
 */
export async function getImageMetadataAsync(imageBytes: Buffer): Promise<ImageMetadata> {
  const metadata = await sharp(imageBytes).metadata();
  return {
    width: metadata.width || null,
    height: metadata.height || null,
    format: metadata.format || null,
    size: imageBytes.length,
  };
}

/**
 * Synchronous metadata extraction (simplified, format detection from magic bytes).
 */
export function getImageMetadata(imageBytes: Buffer): ImageMetadata {
  const metadata: ImageMetadata = {
    width: null,
    height: null,
    format: null,
    size: imageBytes.length,
  };

  if (imageBytes.length >= 4) {
    // PNG: 89 50 4E 47
    if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
      metadata.format = "png";
    }
    // JPEG: FF D8 FF
    else if (imageBytes[0] === 0xff && imageBytes[1] === 0xd8) {
      metadata.format = "jpeg";
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    else if (imageBytes[0] === 0x52 && imageBytes[1] === 0x49 && imageBytes[8] === 0x57 && imageBytes[9] === 0x45) {
      metadata.format = "webp";
    }
    // GIF: 47 49 46 38
    else if (imageBytes[0] === 0x47 && imageBytes[1] === 0x49 && imageBytes[2] === 0x46 && imageBytes[3] === 0x38) {
      metadata.format = "gif";
    }
  }

  return metadata;
}

/**
 * Create a thumbnail from image bytes.
 */
export async function createThumbnail(imageBytes: Buffer, size: number = 128): Promise<Buffer> {
  return sharp(imageBytes)
    .resize(size, size, {
      fit: "cover",
      position: "center",
    })
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Strip metadata from image.
 */
export async function stripMetadata(imageBytes: Buffer): Promise<Buffer> {
  return sharp(imageBytes).webp({ quality: 80 }).toBuffer();
}

/**
 * Clear the preview cache (useful for testing or memory management).
 */
export function clearPreviewCache(): void {
  PREVIEW_CACHE.clear();
}
