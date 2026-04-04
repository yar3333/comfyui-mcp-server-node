import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import sharp from "sharp";

interface PublishConfigData {
  project_root: string | null;
  publish_root: string | null;
  comfyui_output_root: string | null;
}

interface ManifestEntry {
  source: string;
  published: string;
  size: number;
  mime_type: string;
  published_at: string;
}

export class PublishConfig {
  public projectRoot: string | null = null;
  public projectRootMethod: string | null = null;
  public publishRoot: string | null = null;
  public comfyuiOutputRoot: string | null = null;
  public comfyuiOutputMethod: string | null = null;
  public comfyuiTriedPaths: string[] = [];
  public comfyuiUrl: string;

  constructor(comfyuiOutputRoot?: string | null, comfyuiUrl: string = "http://localhost:8188") {
    this.comfyuiUrl = comfyuiUrl;

    if (comfyuiOutputRoot) {
      this.comfyuiOutputRoot = comfyuiOutputRoot;
      this.comfyuiOutputMethod = "env_var";
    }

    this._detectProjectRoot();
    this._detectPublishRoot();
    this._detectComfyuiOutputRoot();
  }

  private _detectProjectRoot(): void {
    // Try to detect project root from common patterns
    const possibleRoots = [process.cwd(), path.resolve(process.cwd(), ".."), path.resolve(process.cwd(), "..", "..")];

    for (const root of possibleRoots) {
      // Look for common project indicators
      const indicators = ["package.json", "public", "static", "src"];
      for (const indicator of indicators) {
        if (fs.existsSync(path.join(root, indicator))) {
          this.projectRoot = root;
          this.projectRootMethod = `detected_${indicator}`;
          return;
        }
      }
    }

    // Fallback to current directory
    this.projectRoot = process.cwd();
    this.projectRootMethod = "fallback_cwd";
  }

  private _detectPublishRoot(): void {
    if (!this.projectRoot) return;

    // Try common publish directories
    const possiblePaths = [
      path.join(this.projectRoot, "public", "gen"),
      path.join(this.projectRoot, "static", "gen"),
      path.join(this.projectRoot, "assets", "gen"),
    ];

    for (const pubPath of possiblePaths) {
      const parentDir = path.dirname(pubPath);
      if (fs.existsSync(parentDir)) {
        this.publishRoot = pubPath;
        if (!fs.existsSync(pubPath)) {
          fs.mkdirSync(pubPath, { recursive: true });
        }
        return;
      }
    }

    // Create default
    this.publishRoot = path.join(this.projectRoot, "public", "gen");
    if (!fs.existsSync(this.publishRoot!)) {
      fs.mkdirSync(this.publishRoot!, { recursive: true });
    }
  }

  private _detectComfyuiOutputRoot(): void {
    if (this.comfyuiOutputRoot) return;

    // Try common ComfyUI output paths
    const possiblePaths = [
      path.join(os.homedir(), "ComfyUI", "output"),
      path.join(os.homedir(), "comfyui", "output"),
      "C:\\ComfyUI\\output",
      "/home/comfyui/ComfyUI/output",
    ];

    this.comfyuiTriedPaths = possiblePaths;

    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        this.comfyuiOutputRoot = testPath;
        this.comfyuiOutputMethod = "detected";
        return;
      }
    }
  }
}

export class PublishManager {
  private config: PublishConfig;

  constructor(config: PublishConfig) {
    this.config = config;
  }

  public getConfig(): PublishConfig {
    return this.config;
  }

  public async publishAsset(
    sourcePath: string,
    targetFilename: string,
    manifestKeyArg?: string,
    webOptimize: boolean = false,
    maxBytes?: number,
    overwrite: boolean = false,
  ): Promise<{ target_path: string; size: number; manifest_key?: string }> {
    // Validate paths
    this._validateSourcePath(sourcePath);

    if (!this.config.publishRoot) {
      throw new Error("Publish root not configured");
    }

    const targetPath = path.join(this.config.publishRoot, targetFilename);
    this._validateTargetPath(targetPath, this.config.publishRoot);

    // Create target directory if needed
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Check if target exists and overwrite is false
    if (fs.existsSync(targetPath) && !overwrite) {
      throw new Error(`Target file already exists: ${targetPath}`);
    }

    let processedBuffer = fs.readFileSync(sourcePath) as Buffer;

    // Apply web optimization if requested
    if (webOptimize) {
      processedBuffer = await this._optimizeForWeb(processedBuffer, maxBytes);
    }

    // Atomic write (temp file + rename)
    const tempPath = targetPath + ".tmp";
    fs.writeFileSync(tempPath, processedBuffer);
    fs.renameSync(tempPath, targetPath);

    const finalSize = fs.statSync(targetPath).size;

    // Update manifest if manifest_key provided
    let manifestKeyResult: string | undefined;
    if (manifestKeyArg) {
      manifestKeyResult = await this._updateManifest(manifestKeyArg, targetFilename, finalSize, sourcePath);
    }

    // Log operation
    this._logOperation({
      action: "publish",
      source: sourcePath,
      target: targetPath,
      size: finalSize,
      web_optimize: webOptimize,
      timestamp: new Date().toISOString(),
    });

    return {
      target_path: targetPath,
      size: finalSize,
      manifest_key: manifestKeyResult,
    };
  }

  private _validateSourcePath(sourcePath: string): void {
    const resolved = path.resolve(sourcePath);

    if (!this.config.comfyuiOutputRoot) {
      throw new Error("ComfyUI output root not configured");
    }

    const comfyuiRoot = path.resolve(this.config.comfyuiOutputRoot);

    // Check for path traversal
    if (!resolved.startsWith(comfyuiRoot)) {
      throw new Error(`Source path must be within ComfyUI output root: ${sourcePath}`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }
  }

  private _validateTargetPath(targetPath: string, publishRoot: string): void {
    const resolved = path.resolve(targetPath);
    const resolvedRoot = path.resolve(publishRoot);

    // Check for path traversal
    if (!resolved.startsWith(resolvedRoot)) {
      throw new Error(`Target path must be within publish root: ${targetPath}`);
    }
  }

  private async _optimizeForWeb(imageBuffer: Buffer, maxBytes?: number): Promise<Buffer> {
    // Deterministic compression ladder: quality 85->35, downscale 1.0->0.5
    const qualityLevels = [85, 70, 55, 40, 35];
    const scaleFactors = [1.0, 0.75, 0.5];

    for (const quality of qualityLevels) {
      for (const scale of scaleFactors) {
        let processed = sharp(imageBuffer);

        if (scale < 1.0) {
          const metadata = await processed.metadata();
          if (metadata.width && metadata.height) {
            processed = processed.resize({
              width: Math.floor(metadata.width * scale),
              height: Math.floor(metadata.height * scale),
            });
          }
        }

        const optimized = await processed.webp({ quality }).toBuffer();

        if (!maxBytes || optimized.length <= maxBytes) {
          return optimized;
        }
      }
    }

    // Last resort: return lowest quality
    return sharp(imageBuffer).webp({ quality: 35 }).toBuffer();
  }

  private async _updateManifest(
    manifestKey: string,
    targetFilename: string,
    size: number,
    sourcePath: string,
  ): Promise<string> {
    if (!this.config.publishRoot) {
      throw new Error("Publish root not configured");
    }

    const manifestPath = path.join(this.config.publishRoot, "manifest.json");
    let manifest: Record<string, ManifestEntry> = {};

    // Load existing manifest
    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, "utf-8");
        manifest = JSON.parse(content);
      } catch (error) {
        console.warn("Failed to load manifest, creating new one");
      }
    }

    // Determine MIME type
    const ext = path.extname(targetFilename).toLowerCase();
    const mimeType = this._getMimeType(ext);

    // Update manifest
    manifest[manifestKey] = {
      source: sourcePath,
      published: targetFilename,
      size,
      mime_type: mimeType,
      published_at: new Date().toISOString(),
    };

    // Atomic write
    const tempPath = manifestPath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2));
    fs.renameSync(tempPath, manifestPath);

    return manifestKey;
  }

  private _getMimeType(ext: string): string {
    switch (ext) {
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".webp":
        return "image/webp";
      case ".gif":
        return "image/gif";
      case ".mp4":
        return "video/mp4";
      case ".mp3":
        return "audio/mpeg";
      default:
        return "application/octet-stream";
    }
  }

  private _logOperation(entry: Record<string, any>): void {
    try {
      const logPath = path.join(os.homedir(), ".config", "comfy-mcp", "publish_log.jsonl");
      const logDir = path.dirname(logPath);

      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const logLine = JSON.stringify(entry) + "\n";
      fs.appendFileSync(logPath, logLine);
    } catch (error) {
      console.warn("Failed to log publish operation:", error);
    }
  }
}
