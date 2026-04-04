import {
  encodePreviewForMcp,
  createThumbnail,
  stripMetadata,
  getImageMetadata,
  clearPreviewCache,
} from "../src/asset_processor";
import { createMockImageBuffer } from "./conftest";
import sharp from "sharp";

describe("Asset Processor", () => {
  beforeEach(() => {
    clearPreviewCache();
  });

  describe("encodePreviewForMcp", () => {
    it("should encode small image within budget", async () => {
      const buffer = createMockImageBuffer();
      const result = await encodePreviewForMcp(buffer, 512);

      expect(result.base64).toBeDefined();
      expect(result.mime_type).toBe("image/webp");
      expect(result.quality).toBeLessThanOrEqual(70);
    });

    it("should respect maxDim parameter", async () => {
      // Create a larger image using sharp
      const largeImage = await sharp({
        create: {
          width: 2000,
          height: 2000,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .png()
        .toBuffer();

      // Clear cache to ensure fresh encoding
      const { clearPreviewCache } = require("../src/asset_processor");
      clearPreviewCache();

      const result = await encodePreviewForMcp(largeImage, 256);

      expect(result.width).toBeLessThanOrEqual(256);
      expect(result.height).toBeLessThanOrEqual(256);
    });

    it("should respect maxB64Chars budget", async () => {
      const largeImage = await sharp({
        create: {
          width: 1000,
          height: 1000,
          channels: 3,
          background: { r: 0, g: 255, b: 0 },
        },
      })
        .png()
        .toBuffer();

      const result = await encodePreviewForMcp(largeImage, 512, 50000);

      expect(result.base64.length).toBeLessThanOrEqual(50000);
    });

    it("should throw error if image cannot fit within budget", async () => {
      const largeImage = await sharp({
        create: {
          width: 2000,
          height: 2000,
          channels: 3,
          background: { r: 0, g: 0, b: 255 },
        },
      })
        .png()
        .toBuffer();

      // Very strict budget should cause error
      await expect(encodePreviewForMcp(largeImage, 100, 100)).rejects.toThrow(/cannot be compressed/i);
    });
  });

  describe("createThumbnail", () => {
    it("should create thumbnail of specified size", async () => {
      const buffer = createMockImageBuffer();
      const thumbnail = await createThumbnail(buffer, 64);

      const metadata = await sharp(thumbnail).metadata();
      expect(metadata.width).toBeLessThanOrEqual(64);
      expect(metadata.height).toBeLessThanOrEqual(64);
    });

    it("should use default size of 128", async () => {
      const buffer = createMockImageBuffer();
      const thumbnail = await createThumbnail(buffer);

      const metadata = await sharp(thumbnail).metadata();
      expect(metadata.width).toBeLessThanOrEqual(128);
    });
  });

  describe("getImageMetadata", () => {
    it("should detect PNG format", () => {
      const buffer = createMockImageBuffer();
      const metadata = getImageMetadata(buffer);

      expect(metadata.format).toBe("png");
    });

    it("should return correct size", () => {
      const buffer = createMockImageBuffer();
      const metadata = getImageMetadata(buffer);

      expect(metadata.size).toBe(buffer.length);
    });
  });

  describe("stripMetadata", () => {
    it("should produce image without metadata", async () => {
      const original = await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
        },
      })
        .png()
        .toBuffer();

      const stripped = await stripMetadata(original);
      const metadata = await sharp(stripped).metadata();

      // Should have valid image metadata
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(100);
    });
  });
});
