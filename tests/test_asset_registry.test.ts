import { AssetRegistry } from "../src/managers/asset_registry";
import { createMockAsset } from "./setup";

jest.useFakeTimers();

describe("AssetRegistry", () => {
  let registry: AssetRegistry;

  beforeEach(() => {
    registry = new AssetRegistry(24, "http://localhost:8188");
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("registerAsset", () => {
    it("should register an asset and return asset_id", () => {
      const asset = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png", width: 512, height: 512, bytes_size: 12345 },
        null,
        null,
        "session-001",
      );

      expect(asset.asset_id).toBeDefined();
      expect(asset.filename).toBe("ComfyUI_00001_.png");
    });

    it("should generate unique asset IDs", () => {
      const asset1 = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
        "session-1",
      );
      const asset2 = registry.registerAsset(
        "ComfyUI_00002_.png",
        "",
        "output",
        "prompt-002",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
        "session-2",
      );

      expect(asset1.asset_id).not.toBe(asset2.asset_id);
    });
  });

  describe("getAsset", () => {
    it("should return registered asset by ID", () => {
      const registered = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      const retrieved = registry.getAsset(registered.asset_id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.filename).toBe("ComfyUI_00001_.png");
    });

    it("should return null for unknown asset ID", () => {
      const asset = registry.getAsset("nonexistent-id");
      expect(asset).toBeNull();
    });
  });

  describe("listAssets", () => {
    it("should return all registered assets", () => {
      registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "p1",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      registry.registerAsset(
        "ComfyUI_00002_.png",
        "",
        "output",
        "p2",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      registry.registerAsset(
        "ComfyUI_00003_.png",
        "",
        "output",
        "p3",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );

      const assets = registry.listAssets(100);
      expect(assets.length).toBe(3);
    });

    it("should respect limit parameter", () => {
      for (let i = 1; i <= 10; i++) {
        registry.registerAsset(
          `ComfyUI_${String(i).padStart(5, "0")}.png`,
          "",
          "output",
          `prompt-${i}`,
          "generate_image",
          { mime_type: "image/png" },
          null,
          null,
        );
      }

      const assets = registry.listAssets(5);
      expect(assets.length).toBe(5);
    });

    it("should filter by workflow_id", () => {
      registry.registerAsset("img1.png", "", "output", "p1", "generate_image", { mime_type: "image/png" }, null, null);
      registry.registerAsset("img2.png", "", "output", "p2", "generate_song", { mime_type: "image/png" }, null, null);
      registry.registerAsset("img3.png", "", "output", "p3", "generate_image", { mime_type: "image/png" }, null, null);

      const assets = registry.listAssets(100, "generate_image");
      expect(assets.length).toBe(2);
      expect(assets.every((a) => a.workflow_id === "generate_image")).toBe(true);
    });

    it("should filter by session_id", () => {
      registry.registerAsset(
        "img1.png",
        "",
        "output",
        "p1",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
        "session-1",
      );
      registry.registerAsset(
        "img2.png",
        "",
        "output",
        "p2",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
        "session-2",
      );
      registry.registerAsset(
        "img3.png",
        "",
        "output",
        "p3",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
        "session-1",
      );

      const assets = registry.listAssets(100, null, "session-1");
      expect(assets.length).toBe(2);
    });
  });

  describe("deleteExpiredAssets", () => {
    it("should remove expired assets", () => {
      const asset = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );

      // Manually set expiry to past
      asset.expires_at = new Date(Date.now() - 1000);

      registry.deleteExpiredAssets();

      const retrieved = registry.getAsset(asset.asset_id);
      expect(retrieved).toBeNull();
    });

    it("should not remove non-expired assets", () => {
      const asset = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );

      registry.deleteExpiredAssets();

      const retrieved = registry.getAsset(asset.asset_id);
      expect(retrieved).not.toBeNull();
    });
  });

  describe("getAssetUrl", () => {
    it("should construct correct URL for asset", () => {
      const asset = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      const url = registry.getAssetUrl(asset);

      expect(url).toContain("http://localhost:8188");
      expect(url).toContain("ComfyUI_00001_.png");
    });

    it("should handle subfolder in URL", () => {
      const asset = registry.registerAsset(
        "ComfyUI_00001_.png",
        "subdir",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      const url = registry.getAssetUrl(asset);

      expect(url).toContain("subdir");
    });
  });

  describe("getAssetByUrl", () => {
    it("should find asset by stable key", () => {
      const asset = registry.registerAsset(
        "ComfyUI_00001_.png",
        "",
        "output",
        "prompt-001",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      const found = registry.getAssetByUrl("ComfyUI_00001_.png", "", "output");

      expect(found).not.toBeNull();
      expect(found?.asset_id).toBe(asset.asset_id);
    });
  });
});
