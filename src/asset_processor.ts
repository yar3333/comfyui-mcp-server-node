import sharp from 'sharp';

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

const MAX_B64_CHARS = 100000; // ~100KB budget

export async function encodePreviewForMcp(
  imageBytes: Buffer,
  maxDim?: number,
  maxB64Chars: number = MAX_B64_CHARS
): Promise<EncodedImage> {
  // Get original dimensions
  const originalMetadata = await sharp(imageBytes).metadata();
  const originalWidth = originalMetadata.width || 0;
  const originalHeight = originalMetadata.height || 0;

  let processed = sharp(imageBytes);
  let currentWidth = originalWidth;
  let currentHeight = originalHeight;

  // Resize if needed
  if (maxDim && (originalWidth > maxDim || originalHeight > maxDim)) {
    processed = processed.resize({
      width: maxDim,
      height: maxDim,
      fit: 'inside',
      withoutEnlargement: true,
    });
    const resizedMetadata = await processed.metadata();
    currentWidth = resizedMetadata.width || originalWidth;
    currentHeight = resizedMetadata.height || originalHeight;
  }

  // Try quality ladder: 70 -> 55 -> 40
  const qualityLevels = [70, 55, 40];
  
  for (const quality of qualityLevels) {
    const webpBuffer = await processed.webp({ quality }).toBuffer();
    const base64 = webpBuffer.toString('base64');

    if (base64.length <= maxB64Chars) {
      return {
        base64,
        mime_type: 'image/webp',
        width: currentWidth,
        height: currentHeight,
        original_width: originalWidth,
        original_height: originalHeight,
        quality,
      };
    }
  }

  // Last resort: use lowest quality
  const webpBuffer = await processed.webp({ quality: 40 }).toBuffer();
  const base64 = webpBuffer.toString('base64');

  return {
    base64,
    mime_type: 'image/webp',
    width: currentWidth,
    height: currentHeight,
    original_width: originalWidth,
    original_height: originalHeight,
    quality: 40,
  };
}

export function getImageMetadata(imageBytes: Buffer): ImageMetadata {
  // Synchronous metadata extraction for basic info
  // This is a simplified version - in production, use async
  const metadata: ImageMetadata = {
    width: null,
    height: null,
    format: null,
    size: imageBytes.length,
  };

  // Try to detect format from magic bytes
  if (imageBytes.length >= 4) {
    // PNG: 89 50 4E 47
    if (imageBytes[0] === 0x89 && imageBytes[1] === 0x50) {
      metadata.format = 'png';
    }
    // JPEG: FF D8 FF
    else if (imageBytes[0] === 0xFF && imageBytes[1] === 0xD8) {
      metadata.format = 'jpeg';
    }
    // WebP: 52 49 46 46 ... 57 45 42 50
    else if (
      imageBytes[0] === 0x52 &&
      imageBytes[1] === 0x49 &&
      imageBytes[8] === 0x57 &&
      imageBytes[9] === 0x45
    ) {
      metadata.format = 'webp';
    }
  }

  return metadata;
}

export async function createThumbnail(
  imageBytes: Buffer,
  size: number = 128
): Promise<Buffer> {
  return sharp(imageBytes)
    .resize(size, size, {
      fit: 'cover',
      position: 'center',
    })
    .webp({ quality: 80 })
    .toBuffer();
}

export async function stripMetadata(imageBytes: Buffer): Promise<Buffer> {
  return sharp(imageBytes)
    .withMetadata({})
    .toBuffer();
}
