import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ComfyUIClient } from "../comfyui_client";

type Namespace = "image" | "audio" | "video";

interface ConfigData {
  defaults: {
    image?: Record<string, any>;
    audio?: Record<string, any>;
    video?: Record<string, any>;
  };
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "comfy-mcp");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export class DefaultsManager {
  private client: ComfyUIClient;
  private runtimeDefaults: Record<string, Record<string, any>> = {
    image: {},
    audio: {},
    video: {},
  };
  private configPath: string;
  private configDefaults: Record<string, Record<string, any>> = {
    image: {},
    audio: {},
    video: {},
  };
  private availableModelsSet: Set<string> = new Set();
  private invalidModels: Record<string, string> = {}; // namespace -> model name
  private defaultSources: Record<string, Record<string, string>> = {}; // tracks source per namespace/key

  // Hardcoded defaults (matching Python original)
  private hardcodedDefaults: Record<string, Record<string, any>> = {
    image: {
      width: 512,
      height: 512,
      steps: 20,
      cfg: 8.0,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1.0,
      model: "v1-5-pruned-emaonly.safetensors",
      seed: -1,
      negative_prompt: "text, watermark",
    },
    audio: {
      steps: 50,
      cfg: 5.0,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1.0,
      seconds: 60,
      lyrics_strength: 0.99,
      model: "ace_step_v1_3.5b.safetensors",
      seed: -1,
    },
    video: {
      width: 1280,
      height: 720,
      steps: 20,
      cfg: 8.0,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1.0,
      negative_prompt: "text, watermark",
      duration: 5,
      fps: 16,
    },
  };

  constructor(client: ComfyUIClient) {
    this.client = client;
    this.configPath = CONFIG_FILE;
    this._loadConfigDefaults();
    this._initializeModelDefaults();
  }

  private _loadConfigDefaults(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf-8");
        const config: ConfigData = JSON.parse(content);
        this.configDefaults = {
          image: config.defaults?.image || {},
          audio: config.defaults?.audio || {},
          video: config.defaults?.video || {},
        };
      }
    } catch (error) {
      console.warn("Failed to load config defaults:", error);
    }
  }

  private _getEnvDefaults(): Record<string, Record<string, any>> {
    const defaults: Record<string, Record<string, any>> = {
      image: {},
      audio: {},
      video: {},
    };
    const imageModel = process.env.COMFY_MCP_DEFAULT_IMAGE_MODEL;
    const audioModel = process.env.COMFY_MCP_DEFAULT_AUDIO_MODEL;
    const videoModel = process.env.COMFY_MCP_DEFAULT_VIDEO_MODEL;
    if (imageModel) defaults.image.model = imageModel;
    if (audioModel) defaults.audio.model = audioModel;
    if (videoModel) defaults.video.model = videoModel;
    return defaults;
  }

  private async _initializeModelDefaults(): Promise<void> {
    try {
      const models = await this.client.getAvailableModels();
      if (models.length > 0) {
        // Set model from first available if hardcoded default is null
        if (this.hardcodedDefaults.image.model === null) {
          this.hardcodedDefaults.image.model = models[0];
        }
        if (this.hardcodedDefaults.audio.model === null) {
          this.hardcodedDefaults.audio.model = models[0];
        }
      }
    } catch (error) {
      console.warn("Failed to initialize model defaults:", error);
    }
  }

  public async initialize(): Promise<void> {
    await this._initializeModelDefaults();
    // Validate all defaults at startup
    this.validateAllDefaults();
  }

  public get(parameterName: string, namespace?: Namespace): any {
    // Check runtime defaults
    if (namespace && parameterName in (this.runtimeDefaults[namespace] || {})) {
      return this.runtimeDefaults[namespace][parameterName];
    }
    if (parameterName in this.runtimeDefaults.image) {
      // Check flat runtime defaults (non-namespace)
      return this.runtimeDefaults.image[parameterName];
    }

    // Check config defaults
    if (namespace && parameterName in (this.configDefaults[namespace] || {})) {
      return this.configDefaults[namespace][parameterName];
    }

    // Check env vars
    const envDefaults = this._getEnvDefaults();
    if (namespace && parameterName in (envDefaults[namespace] || {})) {
      return envDefaults[namespace][parameterName];
    }

    // Check hardcoded defaults
    if (namespace && this.hardcodedDefaults[namespace]) {
      return this.hardcodedDefaults[namespace][parameterName];
    }

    return undefined;
  }

  /**
   * Get default value with full precedence:
   * provided > runtime > config > env > hardcoded
   */
  public getDefault(namespace: Namespace, key: string, providedValue?: any): any {
    if (providedValue !== undefined && providedValue !== null) {
      return providedValue;
    }

    // Runtime defaults (highest priority after provided)
    if (key in (this.runtimeDefaults[namespace] || {})) {
      return this.runtimeDefaults[namespace][key];
    }

    // Config file defaults
    if (key in (this.configDefaults[namespace] || {})) {
      return this.configDefaults[namespace][key];
    }

    // Env defaults
    const envDefaults = this._getEnvDefaults();
    if (key in (envDefaults[namespace] || {})) {
      return envDefaults[namespace][key];
    }

    // Hardcoded defaults (lowest priority)
    if (key in (this.hardcodedDefaults[namespace] || {})) {
      return this.hardcodedDefaults[namespace][key];
    }

    return null;
  }

  public getAll(namespace?: Namespace): Record<string, any> {
    const envDefaults = this._getEnvDefaults();
    const namespaces = namespace ? [namespace] : (["image", "audio", "video"] as Namespace[]);
    const result: Record<string, any> = {};

    for (const ns of namespaces) {
      result[ns] = {
        ...(this.hardcodedDefaults[ns] || {}),
        ...(envDefaults[ns] || {}),
        ...(this.configDefaults[ns] || {}),
        ...(this.runtimeDefaults[ns] || {}),
      };
    }

    return namespace ? result[namespace] : result;
  }

  /**
   * Set runtime defaults for a namespace.
   * Returns validation errors if model validation fails.
   */
  public setDefaults(
    namespace: Namespace,
    defaults: Record<string, any>,
    validateModels: boolean = true,
  ): Record<string, any> {
    const errors: string[] = [];

    if (!["image", "audio", "video"].includes(namespace)) {
      return { error: `Invalid namespace: ${namespace}. Must be 'image', 'audio', or 'video'` };
    }

    // Validate model names if provided
    if (validateModels && "model" in defaults) {
      const modelName = defaults.model;
      if (this.availableModelsSet.size > 0 && !this.availableModelsSet.has(modelName)) {
        const available = Array.from(this.availableModelsSet).slice(0, 5);
        errors.push(`Model '${modelName}' not found. Available models: ${available.join(", ")}...`);
      }
    }

    if (errors.length > 0) {
      return { errors };
    }

    // Update runtime defaults
    if (!this.runtimeDefaults[namespace]) {
      this.runtimeDefaults[namespace] = {};
    }
    this.runtimeDefaults[namespace] = {
      ...this.runtimeDefaults[namespace],
      ...defaults,
    };

    // If model was set and it's valid, clear invalid flag
    if ("model" in defaults && validateModels) {
      if (this.availableModelsSet.has(defaults.model)) {
        delete this.invalidModels[namespace];
      }
    }

    return { success: true, updated: defaults };
  }

  public set(parameterName: string, value: any, persist: boolean = false): void {
    this.runtimeDefaults.image[parameterName] = value;

    if (persist) {
      this._persistConfig();
    }
  }

  public setNamespaceDefaults(
    namespace: Namespace,
    defaults: Record<string, any>,
    persist: boolean = false,
  ): Record<string, any> {
    const result = this.setDefaults(namespace, defaults);
    if (persist && !("error" in result) && !("errors" in result)) {
      this.persistDefaults(namespace, defaults);
    }
    return result;
  }

  public async validateModel(modelName: string): Promise<boolean> {
    try {
      const models = await this.client.getAvailableModels();
      return models.includes(modelName);
    } catch (error) {
      console.warn("Failed to validate model:", error);
      return false;
    }
  }

  /**
   * Validate the default model for a namespace.
   * Returns [is_valid, model_name, source]
   */
  public validateDefaultModel(namespace: Namespace): [boolean, string, string] {
    const modelName = this.getDefault(namespace, "model");
    if (!modelName) {
      return [true, "", "none"]; // No model default
    }

    const source = this._getDefaultSource(namespace, "model");

    if (this.availableModelsSet.has(modelName)) {
      return [true, modelName, source];
    }

    return [false, modelName, source];
  }

  public isModelValid(namespace: Namespace, model: string): boolean {
    if (!model) return true; // No model specified
    if (this.invalidModels[namespace] === model) return false;
    return this.availableModelsSet.has(model);
  }

  public markModelInvalid(namespace: Namespace, model: string): void {
    this.invalidModels[namespace] = model;
  }

  public async refreshModelSet(): Promise<void> {
    try {
      const models = await this.client.getAvailableModels();
      this.availableModelsSet = new Set(models);
    } catch {
      this.availableModelsSet = new Set();
    }
  }

  public async validateAllDefaults(): Promise<void> {
    await this.refreshModelSet();

    for (const ns of ["image", "audio", "video"] as Namespace[]) {
      const [isValid, modelName, source] = this.validateDefaultModel(ns);
      if (!isValid && modelName) {
        console.warn(
          `Default model '${modelName}' (from ${source} defaults) for ${ns} namespace ` +
            `not found in ComfyUI checkpoints. Set a valid model via set_defaults, ` +
            `config file, or env var. Try list_models to see available checkpoints.`,
        );
        this.markModelInvalid(ns, modelName);
      }
    }
  }

  public persistDefaults(namespace: Namespace, defaults: Record<string, any>): Record<string, any> {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      let config: ConfigData = { defaults: {} };
      if (fs.existsSync(this.configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
        } catch {
          config = { defaults: {} };
        }
      }

      if (!config.defaults) config.defaults = {};
      if (!config.defaults[namespace]) config.defaults[namespace] = {};
      config.defaults[namespace] = {
        ...config.defaults[namespace],
        ...defaults,
      };

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8");

      // Reload config defaults
      this._loadConfigDefaults();

      return { success: true, persisted: defaults };
    } catch (error: any) {
      return { error: `Failed to write config file: ${error.message}` };
    }
  }

  private _getDefaultSource(namespace: Namespace, key: string): string {
    if (key in (this.runtimeDefaults[namespace] || {})) return "runtime";
    if (key in (this.configDefaults[namespace] || {})) return "config";
    const envDefaults = this._getEnvDefaults();
    if (key in (envDefaults[namespace] || {})) return "env";
    if (key in (this.hardcodedDefaults[namespace] || {})) return "hardcoded";
    return "unknown";
  }

  private _persistConfig(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const config: ConfigData = { defaults: {} };

      for (const ns of ["image", "audio", "video"] as Namespace[]) {
        if (Object.keys(this.runtimeDefaults[ns] || {}).length > 0) {
          config.defaults[ns] = this.runtimeDefaults[ns];
        }
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8");
      console.info(`Persisted defaults to ${this.configPath}`);
    } catch (error) {
      console.error("Failed to persist defaults:", error);
    }
  }

  private _parseEnvValue(value: string): any {
    if (!isNaN(Number(value))) return Number(value);
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
    return value;
  }
}
