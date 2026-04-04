import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import sharp from "sharp";

// Target filename validation regex: simple filename only, no paths
const TARGET_FILENAME_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}\.(webp|png|jpg|jpeg)$/;
// Manifest key validation regex: same as target_filename but no extension
const MANIFEST_KEY_REGEX = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface TriedPathInfo {
  path: string;
  exists: boolean;
  is_valid: boolean;
  source: string;
  error?: string;
}

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
  public comfyuiTriedPaths: TriedPathInfo[] = [];
  public comfyuiUrl: string;

  constructor(
    publishRoot?: string | null,
    comfyuiOutputRoot?: string | null,
    comfyuiUrl: string = "http://localhost:8188",
  ) {
    this.comfyuiUrl = comfyuiUrl;

    if (comfyuiOutputRoot) {
      this.comfyuiOutputRoot = comfyuiOutputRoot;
      this.comfyuiOutputMethod = "env_var";
    }

    this._detectProjectRoot();
    this._detectPublishRoot();
    this._detectComfyuiOutputRoot();

    // Override publish root if explicitly provided
    if (publishRoot) {
      this.publishRoot = publishRoot;
      if (!fs.existsSync(publishRoot)) {
        fs.mkdirSync(publishRoot, { recursive: true });
      }
    }
  }

  private _detectProjectRoot(): void {
    const cwd = process.cwd();
    const projectMarkers = [".git", "package.json", "pyproject.toml", "Cargo.toml"];

    // Check if cwd has project markers or public/static dirs
    const hasMarkers = projectMarkers.some((m) => fs.existsSync(path.join(cwd, m)));
    const hasPublic = fs.existsSync(path.join(cwd, "public")) || fs.existsSync(path.join(cwd, "static"));

    if (hasMarkers || hasPublic) {
      this.projectRoot = cwd;
      this.projectRootMethod = "cwd";
      return;
    }

    // Conservative fallback: search upward for markers
    const foundMarkers: Array<{ root: string; markers: string[] }> = [];
    let current = cwd;

    for (let i = 0; i < 10; i++) {
      const markersHere = projectMarkers.filter((m) => fs.existsSync(path.join(current, m)));
      if (markersHere.length > 0) {
        foundMarkers.push({ root: current, markers: markersHere });
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    if (foundMarkers.length === 0) {
      // No markers, use cwd
      console.warn("No project markers found, using cwd as project root");
      this.projectRoot = cwd;
      this.projectRootMethod = "cwd";
    } else if (foundMarkers.length === 1) {
      this.projectRoot = foundMarkers[0].root;
      this.projectRootMethod = "auto-detected";
    } else {
      // Ambiguous - use cwd anyway
      this.projectRoot = cwd;
      this.projectRootMethod = "cwd";
    }
  }

  private _detectPublishRoot(): void {
    if (!this.projectRoot) return;

    const candidates = [
      path.join(this.projectRoot, "public", "gen"),
      path.join(this.projectRoot, "static", "gen"),
      path.join(this.projectRoot, "assets", "gen"),
    ];

    for (const pubPath of candidates) {
      const parentDir = path.dirname(pubPath);
      if (fs.existsSync(parentDir)) {
        this.publishRoot = pubPath;
        if (!fs.existsSync(pubPath)) {
          fs.mkdirSync(pubPath, { recursive: true });
        }
        return;
      }
    }

    // Default
    this.publishRoot = path.join(this.projectRoot, "public", "gen");
    if (!fs.existsSync(this.publishRoot)) {
      fs.mkdirSync(this.publishRoot, { recursive: true });
    }
  }

  private _detectComfyuiOutputRoot(): void {
    if (this.comfyuiOutputRoot) return;

    // 1. Check persistent config
    const persistentConfig = loadPublishConfig();
    const configuredPath = persistentConfig.comfyui_output_root;
    if (configuredPath) {
      try {
        const resolved = path.resolve(configuredPath);
        const exists = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
        const isValid = exists && validateComfyuiOutputRoot(resolved);

        this.comfyuiTriedPaths.push({
          path: resolved,
          exists,
          is_valid: isValid,
          source: "persistent_config",
        });

        if (isValid) {
          this.comfyuiOutputRoot = resolved;
          this.comfyuiOutputMethod = "persistent_config";
          return;
        } else if (exists) {
          this.comfyuiOutputRoot = resolved;
          this.comfyuiOutputMethod = "persistent_config";
          return;
        }
      } catch {
        // ignore
      }
    }

    // 2. Tight candidate list
    const possiblePaths: string[] = [];

    if (this.projectRoot) {
      possiblePaths.push(path.join(this.projectRoot, "comfyui-desktop", "output"));
      possiblePaths.push(path.join(path.dirname(this.projectRoot), "comfyui-desktop", "output"));
      possiblePaths.push(path.join(this.projectRoot, "ComfyUI", "output"));
    }

    possiblePaths.push(path.join(os.homedir(), "comfyui-desktop", "output"));

    // Platform-specific
    if (os.platform() === "win32") {
      possiblePaths.push("E:/comfyui-desktop/output");
    }

    // Also try standard paths
    possiblePaths.push(path.join(os.homedir(), "ComfyUI", "output"));
    possiblePaths.push(path.join(os.homedir(), "comfyui", "output"));
    possiblePaths.push("C:\\ComfyUI\\output");

    for (const testPath of possiblePaths) {
      try {
        const resolved = path.resolve(testPath);
        const exists = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
        const isValid = exists && validateComfyuiOutputRoot(resolved);

        this.comfyuiTriedPaths.push({
          path: resolved,
          exists,
          is_valid: isValid,
          source: "auto_detection",
        });

        if (isValid) {
          this.comfyuiOutputRoot = resolved;
          this.comfyuiOutputMethod = "auto-detected";
          return;
        }
      } catch (e: any) {
        this.comfyuiTriedPaths.push({
          path: testPath,
          exists: false,
          is_valid: false,
          source: "auto_detection",
          error: e.message,
        });
      }
    }
  }
}

// ============ Persistent Config Functions ============

function getPublishConfigDir(): string {
  const platform = os.platform();
  if (platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) return path.join(appdata, "comfyui-mcp-server-node");
    return path.join(os.homedir(), "AppData", "Roaming", "comfyui-mcp-server-node");
  } else if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "comfyui-mcp-server-node");
  }
  return path.join(os.homedir(), ".config", "comfyui-mcp-server-node");
}

function getPublishConfigFile(): string {
  return path.join(getPublishConfigDir(), "publish_config.json");
}

export function loadPublishConfig(): { comfyui_output_root?: string } {
  const configFile = getPublishConfigFile();
  if (!fs.existsSync(configFile)) return {};

  try {
    const content = fs.readFileSync(configFile, "utf-8");
    const config = JSON.parse(content);
    return typeof config === "object" && config !== null ? config : {};
  } catch {
    return {};
  }
}

function savePublishConfig(config: Record<string, any>): boolean {
  const configFile = getPublishConfigFile();
  const configDir = path.dirname(configFile);

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Merge with existing
    const existing = loadPublishConfig();
    Object.assign(existing, config);

    fs.writeFileSync(configFile, JSON.stringify(existing, null, 2), "utf-8");
    console.info(`Saved publish config to ${configFile}`);
    return true;
  } catch (e: any) {
    console.error(`Failed to save publish config: ${e.message}`);
    return false;
  }
}

// ============ Validation Functions ============

function validateComfyuiOutputRoot(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;

  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) return false;

  // Strong indicator: ComfyUI_*.png files
  const files = fs.readdirSync(dirPath);
  const hasComfyuiPng = files.some((f) => /^ComfyUI_.*\.png$/i.test(f));
  if (hasComfyuiPng) return true;

  // Check for output/ or temp/ subdirs
  if (fs.existsSync(path.join(dirPath, "output")) || fs.existsSync(path.join(dirPath, "temp"))) {
    return true;
  }

  // Lenient: check for image files
  const imageExts = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
  let imageCount = 0;
  for (const f of files) {
    if (imageExts.includes(path.extname(f).toLowerCase())) {
      imageCount++;
      if (imageCount >= 3) return true;
    }
  }

  return false;
}

function canonicalizePath(filePath: string, mustExist: boolean = true): string {
  const resolved = path.resolve(filePath);
  if (mustExist && !fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  return resolved;
}

function isWithin(childPath: string, parentPath: string, childMustExist: boolean = true): boolean {
  try {
    const childReal = canonicalizePath(childPath, childMustExist);
    const parentReal = canonicalizePath(parentPath, true);

    const relative = path.relative(parentReal, childReal);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

function validateTargetFilename(filename: string): boolean {
  return TARGET_FILENAME_REGEX.test(filename);
}

function validateManifestKey(key: string): boolean {
  return MANIFEST_KEY_REGEX.test(key);
}

function autoGenerateFilename(assetId: string, format: string = "webp"): string {
  const shortid = assetId.length >= 8 ? assetId.slice(0, 8) : assetId;
  const cleanFormat = format.startsWith(".") ? format.slice(1) : format || "webp";
  return `asset_${shortid}.${cleanFormat}`;
}

// ============ PublishManager Class ============

export class PublishManager {
  private config: PublishConfig;

  constructor(config: PublishConfig) {
    this.config = config;
  }

  public getConfig(): PublishConfig {
    return this.config;
  }

  public ensureReady(): {
    is_ready: boolean;
    error_code?: string;
    error_info?: Record<string, any>;
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check publishRoot is writable
    if (this.config.publishRoot && fs.existsSync(this.config.publishRoot)) {
      try {
        fs.accessSync(this.config.publishRoot, fs.constants.W_OK);
      } catch {
        return {
          is_ready: false,
          error_code: "PUBLISH_ROOT_NOT_WRITABLE",
          error_info: {
            publish_root: this.config.publishRoot,
            message: `Publish root is not writable: ${this.config.publishRoot}`,
          },
        };
      }
    }

    // Check ComfyUI output root
    if (!this.config.comfyuiOutputRoot) {
      return {
        is_ready: false,
        error_code: "COMFYUI_OUTPUT_ROOT_NOT_FOUND",
        error_info: {
          tried_paths: this.config.comfyuiTriedPaths,
          message: "COMFYUI_OUTPUT_ROOT not configured. Use the set_comfyui_output_root tool to configure it.",
        },
      };
    }

    if (!fs.existsSync(this.config.comfyuiOutputRoot)) {
      return {
        is_ready: false,
        error_code: "COMFYUI_OUTPUT_ROOT_NOT_FOUND",
        error_info: {
          comfyui_output_root: this.config.comfyuiOutputRoot,
          message: `ComfyUI output root does not exist: ${this.config.comfyuiOutputRoot}`,
        },
      };
    }

    if (!validateComfyuiOutputRoot(this.config.comfyuiOutputRoot)) {
      warnings.push(`ComfyUI output root may not be valid: ${this.config.comfyuiOutputRoot}`);
    }

    if (this.config.projectRootMethod === "auto-detected") {
      warnings.push("Using fallback project root detection (start server from repo root for best results)");
    }

    if (this.config.comfyuiOutputMethod === "auto-detected") {
      warnings.push("Using auto-detected ComfyUI output root (set COMFYUI_OUTPUT_ROOT for explicit control)");
    }

    return {
      is_ready: true,
      ...(warnings.length > 0 ? { error_info: { warnings } } : {}),
    };
  }

  public resolveSourcePath(subfolder: string, filename: string): string {
    if (!this.config.comfyuiOutputRoot) {
      throw new Error("ComfyUI output root not configured");
    }

    let sourcePath: string;
    if (subfolder) {
      sourcePath = path.join(this.config.comfyuiOutputRoot, subfolder, filename);
    } else {
      sourcePath = path.join(this.config.comfyuiOutputRoot, filename);
    }

    const resolved = path.resolve(sourcePath);
    const comfyuiRoot = path.resolve(this.config.comfyuiOutputRoot);

    if (!isWithin(resolved, comfyuiRoot)) {
      throw new Error(`Source path must be within ComfyUI output root: ${sourcePath}`);
    }

    if (!fs.existsSync(resolved)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    return resolved;
  }

  public resolveTargetPath(targetFilename: string): string {
    if (!this.config.publishRoot) {
      throw new Error("Publish root not configured");
    }

    if (!validateTargetFilename(targetFilename)) {
      throw new Error(
        `Invalid target_filename: '${targetFilename}'. Must match: ^[a-z0-9][a-z0-9._-]{0,63}\\.(webp|png|jpg|jpeg)$`,
      );
    }

    const targetPath = path.join(this.config.publishRoot, targetFilename);
    const resolved = path.resolve(targetPath);
    const publishRootResolved = path.resolve(this.config.publishRoot);

    if (!isWithin(resolved, publishRootResolved, false)) {
      throw new Error(`Target path must be within publish root: ${targetPath}`);
    }

    return resolved;
  }

  public getPublishInfo(): Record<string, any> {
    const ready = this.ensureReady();
    const configFile = getPublishConfigFile();
    const persistentConfig = loadPublishConfig();

    const publishRootExists = this.config.publishRoot ? fs.existsSync(this.config.publishRoot) : false;
    const publishRootWritable = publishRootExists
      ? (() => {
          try {
            fs.accessSync(this.config.publishRoot!, fs.constants.W_OK);
            return true;
          } catch {
            return false;
          }
        })()
      : false;

    const comfyuiExists = this.config.comfyuiOutputRoot ? fs.existsSync(this.config.comfyuiOutputRoot) : false;

    let status = "ready";
    if (!ready.is_ready) {
      status = ready.error_code === "COMFYUI_OUTPUT_ROOT_NOT_FOUND" ? "needs_comfyui_root" : "error";
    }

    const result: Record<string, any> = {
      project_root: {
        path: this.config.projectRoot,
        detection_method: this.config.projectRootMethod,
      },
      publish_root: {
        path: this.config.publishRoot,
        exists: publishRootExists,
        writable: publishRootWritable,
      },
      comfyui_output_root: {
        path: this.config.comfyuiOutputRoot,
        exists: comfyuiExists,
        detection_method: this.config.comfyuiOutputMethod,
        configured: persistentConfig.comfyui_output_root !== undefined,
      },
      comfyui_tried_paths: this.config.comfyuiTriedPaths,
      config_file: configFile,
      status,
      message: ready.is_ready ? "Ready to publish" : ready.error_info?.message || "Error",
    };

    if (ready.error_info?.warnings) {
      result.warnings = ready.error_info.warnings;
    }

    if (!ready.is_ready && ready.error_code) {
      result.error_code = ready.error_code;
      result.message = `${result.message} Use the set_comfyui_output_root tool to configure it once.`;
    }

    return result;
  }

  public setComfyuiOutputRoot(dirPath: string): Record<string, any> {
    try {
      const resolved = path.resolve(dirPath);

      if (!fs.existsSync(resolved)) {
        return {
          error: "COMFYUI_OUTPUT_ROOT_PATH_NOT_FOUND",
          message: `Path does not exist: ${resolved}`,
          path: resolved,
        };
      }

      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          error: "COMFYUI_OUTPUT_ROOT_NOT_DIRECTORY",
          message: `Path is not a directory: ${resolved}`,
          path: resolved,
        };
      }

      const isValid = validateComfyuiOutputRoot(resolved);
      if (!isValid) {
        return {
          error: "COMFYUI_OUTPUT_ROOT_INVALID",
          message: `Path does not appear to be a ComfyUI output directory: ${resolved}. Expected ComfyUI_*.png files or output/temp subdirectories.`,
          path: resolved,
          warning: "Path saved but validation failed. It may still work if ComfyUI outputs are present.",
        };
      }

      const saved = savePublishConfig({ comfyui_output_root: resolved });
      if (!saved) {
        return {
          error: "CONFIG_SAVE_FAILED",
          message: `Failed to save config to ${getPublishConfigFile()}`,
          path: resolved,
        };
      }

      // Update in memory
      this.config.comfyuiOutputRoot = resolved;
      this.config.comfyuiOutputMethod = "persistent_config";
      this.config.comfyuiTriedPaths = [];

      console.info(`Set ComfyUI output root to: ${resolved}`);

      return {
        success: true,
        path: resolved,
        message: `ComfyUI output root configured: ${resolved}`,
        config_file: getPublishConfigFile(),
      };
    } catch (e: any) {
      return {
        error: "INVALID_PATH",
        message: `Invalid path: ${e.message}`,
        path: dirPath,
      };
    }
  }

  public async publishAsset(
    sourcePath: string,
    targetFilename?: string,
    manifestKeyArg?: string,
    webOptimize: boolean = false,
    maxBytes: number = 600000,
    overwrite: boolean = true,
    libraryMode: boolean = false,
    assetId?: string,
  ): Promise<{
    target_path: string;
    size: number;
    manifest_key?: string;
    dest_url?: string;
    mime_type?: string;
    compression_info?: Record<string, any>;
  }> {
    // Determine target filename
    let finalFilename = targetFilename;
    if (libraryMode && assetId) {
      // Auto-generate filename in library mode
      const ext = targetFilename?.includes(".") ? path.extname(targetFilename).slice(1) : "webp";
      finalFilename = autoGenerateFilename(assetId, webOptimize ? "webp" : ext);
    }

    if (!finalFilename) {
      throw new Error("target_filename is required (unless library_mode is enabled with asset_id)");
    }

    // Validate source path
    const resolvedSource = path.resolve(sourcePath);
    if (!this.config.comfyuiOutputRoot) {
      throw new Error("ComfyUI output root not configured");
    }
    const comfyuiRoot = path.resolve(this.config.comfyuiOutputRoot);
    if (!isWithin(resolvedSource, comfyuiRoot)) {
      throw new Error(`Source path must be within ComfyUI output root: ${sourcePath}`);
    }
    if (!fs.existsSync(resolvedSource)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    // Validate target path
    if (!this.config.publishRoot) {
      throw new Error("Publish root not configured");
    }
    if (!validateTargetFilename(finalFilename)) {
      throw new Error(`Invalid target_filename: '${finalFilename}'. Must match regex.`);
    }
    const targetPath = path.join(this.config.publishRoot, finalFilename);
    const resolvedTarget = path.resolve(targetPath);
    const publishRootResolved = path.resolve(this.config.publishRoot);
    if (!isWithin(resolvedTarget, publishRootResolved, false)) {
      throw new Error(`Target path must be within publish root: ${targetPath}`);
    }

    // Create target directory
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Check overwrite
    if (fs.existsSync(targetPath) && !overwrite) {
      throw new Error(`Target file already exists: ${targetPath}`);
    }

    let processedBuffer: Buffer;
    let compressionInfo: Record<string, any> | undefined;

    // Determine if we should compress
    const sourceExt = path.extname(sourcePath).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(sourceExt);
    const needsCompression = isImage && webOptimize;

    if (needsCompression) {
      const result = await this._compressImage(fs.readFileSync(sourcePath), "webp", maxBytes);
      processedBuffer = result.buffer;
      compressionInfo = result.info;
    } else {
      processedBuffer = fs.readFileSync(sourcePath);
      compressionInfo = { compressed: false, original_size: processedBuffer.length };
    }

    // Atomic write
    const tempPath = targetPath + ".tmp";
    fs.writeFileSync(tempPath, processedBuffer);
    fs.renameSync(tempPath, targetPath);

    const finalSize = fs.statSync(targetPath).size;

    // Determine dest_url
    let destUrl: string;
    try {
      const relPath = path.relative(this.config.publishRoot!, targetPath);
      destUrl = `/gen/${relPath.replace(/\\/g, "/")}`;
    } catch {
      destUrl = `/gen/${finalFilename}`;
    }

    // Determine mime type
    const ext = path.extname(finalFilename).toLowerCase();
    const mimeType = this._getMimeType(ext);

    // Update manifest
    let manifestKeyResult: string | undefined;
    if (manifestKeyArg) {
      manifestKeyResult = await this._updateManifest(manifestKeyArg, finalFilename, finalSize, sourcePath);
    }

    // Log operation
    this._logOperation({
      action: "publish",
      asset_id: assetId,
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
      dest_url: destUrl,
      mime_type: mimeType,
      compression_info: compressionInfo,
    };
  }

  private async _compressImage(
    imageBuffer: Buffer,
    targetFormat: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; info: Record<string, any> }> {
    const originalSize = imageBuffer.length;

    // Quality progression
    const qualityLevels = [85, 75, 65, 55, 45, 35];
    const downscaleFactors = [1.0, 0.9, 0.75, 0.6, 0.5];

    const meta = await sharp(imageBuffer).metadata();
    const originalWidth = meta.width || 0;
    const originalHeight = meta.height || 0;

    for (const factor of downscaleFactors) {
      for (const quality of qualityLevels) {
        let processed = sharp(imageBuffer);

        if (factor < 1.0) {
          processed = processed.resize({
            width: Math.max(1, Math.floor(originalWidth * factor)),
            height: Math.max(1, Math.floor(originalHeight * factor)),
          });
        }

        let optimized: Buffer;
        if (targetFormat === "webp") {
          optimized = await processed.webp({ quality, effort: 5 }).toBuffer();
        } else if (targetFormat === "jpeg" || targetFormat === "jpg") {
          optimized = await processed.jpeg({ quality }).toBuffer();
        } else if (targetFormat === "png") {
          optimized = await processed.png({ compressionLevel: 9 }).toBuffer();
        } else {
          optimized = await processed.webp({ quality }).toBuffer();
        }

        if (optimized.length <= maxBytes) {
          return {
            buffer: optimized,
            info: {
              compressed: true,
              original_size: originalSize,
              final_size: optimized.length,
              quality,
              downscaled: factor < 1.0,
            },
          };
        }
      }
    }

    // Last resort: lowest quality
    const lastResort = await sharp(imageBuffer).webp({ quality: 35, effort: 5 }).toBuffer();

    if (lastResort.length > maxBytes) {
      throw new Error(
        `Image cannot be compressed below ${maxBytes} bytes. Smallest achieved: ${lastResort.length} bytes. Original: ${originalSize} bytes, ${originalWidth}x${originalHeight}`,
      );
    }

    return {
      buffer: lastResort,
      info: {
        compressed: true,
        original_size: originalSize,
        final_size: lastResort.length,
        quality: 35,
        downscaled: false,
      },
    };
  }

  private async _updateManifest(
    manifestKey: string,
    targetFilename: string,
    size: number,
    sourcePath: string,
  ): Promise<string> {
    if (!validateManifestKey(manifestKey)) {
      throw new Error(`Invalid manifest_key: '${manifestKey}'. Must match: ^[a-z0-9][a-z0-9._-]{0,63}$`);
    }

    if (!this.config.publishRoot) {
      throw new Error("Publish root not configured");
    }

    const manifestPath = path.join(this.config.publishRoot, "manifest.json");
    let manifest: Record<string, any> = {};

    // Load existing manifest
    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, "utf-8");
        manifest = JSON.parse(content);
      } catch {
        console.warn("Failed to load manifest, creating new one");
      }
    }

    // Update manifest (simple key->filename like Python version)
    manifest[manifestKey] = targetFilename;

    // Atomic write
    const tempPath = manifestPath + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(manifest, null, 2));
    fs.renameSync(tempPath, manifestPath);

    return manifestKey;
  }

  private _getMimeType(ext: string): string {
    const map: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
    };
    return map[ext] || "application/octet-stream";
  }

  private _logOperation(entry: Record<string, any>): void {
    try {
      if (!this.config.publishRoot) return;
      const logPath = path.join(this.config.publishRoot, "publish_log.jsonl");
      const logLine = JSON.stringify(entry) + "\n";
      fs.appendFileSync(logPath, logLine);
    } catch {
      // ignore
    }
  }
}
