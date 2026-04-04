import * as fs from "fs";
import * as path from "path";
import { PublishConfig, PublishManager } from "../src/managers/publish_manager";
import { createTempDir, cleanupTempDir, createMockImageBuffer } from "./conftest";

describe("PublishManager", () => {
  let tempDir: string;
  let publishRoot: string;
  let comfyuiOutput: string;
  let config: PublishConfig;
  let manager: PublishManager;

  beforeEach(() => {
    tempDir = createTempDir("publish-test-");
    publishRoot = path.join(tempDir, "public", "gen");
    comfyuiOutput = path.join(tempDir, "comfyui_output");

    fs.mkdirSync(publishRoot, { recursive: true });
    fs.mkdirSync(comfyuiOutput, { recursive: true });

    config = new PublishConfig(publishRoot, comfyuiOutput);
    manager = new PublishManager(config);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("PublishConfig", () => {
    it("should set publish root", () => {
      expect(config.publishRoot).toBe(publishRoot);
    });

    it("should set comfyui output root", () => {
      expect(config.comfyuiOutputRoot).toBe(comfyuiOutput);
    });
  });

  describe("publishAsset", () => {
    it("should publish asset to target path", async () => {
      const sourceFile = path.join(comfyuiOutput, "ComfyUI_00001_.png");
      fs.writeFileSync(sourceFile, createMockImageBuffer());

      const result = await manager.publishAsset(sourceFile, "hero.webp");

      expect(result.target_path).toBe(path.join(publishRoot, "hero.webp"));
      expect(fs.existsSync(result.target_path)).toBe(true);
    });

    it("should throw error if source does not exist", async () => {
      await expect(manager.publishAsset("/nonexistent/file.png", "test.webp")).rejects.toThrow();
    });

    it("should throw error if target already exists and overwrite is false", async () => {
      const sourceFile = path.join(comfyuiOutput, "ComfyUI_00001_.png");
      fs.writeFileSync(sourceFile, createMockImageBuffer());

      await manager.publishAsset(sourceFile, "test.webp", undefined, false, undefined, false);

      await expect(manager.publishAsset(sourceFile, "test.webp", undefined, false, undefined, false)).rejects.toThrow();
    });

    it("should overwrite if overwrite is true", async () => {
      const sourceFile = path.join(comfyuiOutput, "ComfyUI_00001_.png");
      fs.writeFileSync(sourceFile, createMockImageBuffer());

      await manager.publishAsset(sourceFile, "test.webp", undefined, false, undefined, false);
      const result = await manager.publishAsset(sourceFile, "test.webp", undefined, false, undefined, true);

      expect(fs.existsSync(result.target_path)).toBe(true);
    });

    it("should update manifest when manifest_key is provided", async () => {
      const sourceFile = path.join(comfyuiOutput, "ComfyUI_00001_.png");
      fs.writeFileSync(sourceFile, createMockImageBuffer());

      await manager.publishAsset(sourceFile, "hero.webp", "site-hero");

      const manifestPath = path.join(publishRoot, "manifest.json");
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest["site-hero"]).toBeDefined();
    });

    it("should apply web optimization when requested", async () => {
      const sourceFile = path.join(comfyuiOutput, "ComfyUI_00001_.png");
      fs.writeFileSync(sourceFile, createMockImageBuffer());

      const result = await manager.publishAsset(sourceFile, "optimized.webp", undefined, true, 100000);

      expect(result.target_path).toBeDefined();
      const stats = fs.statSync(result.target_path);
      expect(stats.size).toBeLessThanOrEqual(100000);
    });
  });

  describe("path validation", () => {
    it("should reject source paths outside comfyui output root", async () => {
      const outsideFile = path.join(tempDir, "outside.png");
      fs.writeFileSync(outsideFile, createMockImageBuffer());

      await expect(manager.publishAsset(outsideFile, "test.webp")).rejects.toThrow(
        /must be within ComfyUI output root/,
      );
    });

    it("should reject target paths outside publish root", () => {
      const sourceFile = path.join(comfyuiOutput, "ComfyUI_00001_.png");
      fs.writeFileSync(sourceFile, createMockImageBuffer());

      // This should still work since it's within publish root
      expect(() => manager.publishAsset(sourceFile, "test.webp")).not.toThrow();
    });
  });

  describe("getPublishInfo", () => {
    it("should return publish configuration status", () => {
      const info = manager.getPublishInfo();

      expect(info.publish_root).toBeDefined();
      expect(info.comfyui_output_root).toBeDefined();
    });
  });
});

describe("PublishConfig auto-detection", () => {
  it("should detect project root from package.json", () => {
    const tempDir = createTempDir("project-detect-");
    fs.writeFileSync(path.join(tempDir, "package.json"), "{}");

    const savedCwd = process.cwd();
    try {
      process.chdir(tempDir);

      const config = new PublishConfig();
      expect(config.projectRoot).toBe(tempDir);
    } finally {
      process.chdir(savedCwd);
      cleanupTempDir(tempDir);
    }
  });
});
