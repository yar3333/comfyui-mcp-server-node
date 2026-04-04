import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ComfyUIClient } from "../comfyui_client";

type Namespace = "image" | "audio" | "video";

interface ConfigData {
  defaults: {
    [key: string]: Record<string, any>;
  };
}

export class DefaultsManager {
  private client: ComfyUIClient;
  private runtimeDefaults: Record<string, any> = {};
  private configPath: string;
  private configDefaults: Record<string, any> = {};

  // Hardcoded defaults
  private hardcodedDefaults: Record<string, any> = {
    image: {
      model: null, // Will be set from ComfyUI models
      steps: 20,
      cfg: 7.0,
      sampler_name: "euler",
      scheduler: "normal",
      width: 1024,
      height: 1024,
      denoise: 1.0,
      seed: -1,
      negative_prompt: "",
    },
    audio: {
      steps: 20,
      cfg: 7.0,
      seconds: 30,
      lyrics_strength: 0.7,
      seed: -1,
    },
    video: {
      steps: 20,
      cfg: 7.0,
      frames: 24,
      seed: -1,
    },
  };

  constructor(client: ComfyUIClient) {
    this.client = client;
    this.configPath = path.join(os.homedir(), ".config", "comfy-mcp", "config.json");
    this._loadConfigDefaults();
    this._initializeModelDefaults();
  }

  private _loadConfigDefaults(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf-8");
        const config: ConfigData = JSON.parse(content);
        this.configDefaults = {
          ...config.defaults.image,
          ...config.defaults.audio,
          ...config.defaults.video,
        };
      }
    } catch (error) {
      console.warn("Failed to load config defaults:", error);
    }
  }

  private async _initializeModelDefaults(): Promise<void> {
    try {
      const models = await this.client.getAvailableModels();
      if (models.length > 0) {
        this.hardcodedDefaults.image.model = models[0];
      }
    } catch (error) {
      console.warn("Failed to initialize model defaults:", error);
    }
  }

  public async initialize(): Promise<void> {
    await this._initializeModelDefaults();
  }

  public get(parameterName: string, namespace?: Namespace): any {
    // Check runtime defaults
    if (parameterName in this.runtimeDefaults) {
      return this.runtimeDefaults[parameterName];
    }

    // Check config defaults
    if (parameterName in this.configDefaults) {
      return this.configDefaults[parameterName];
    }

    // Check env vars
    const envValue = process.env[`COMFY_MCP_${parameterName.toUpperCase()}`];
    if (envValue !== undefined) {
      return this._parseEnvValue(envValue);
    }

    // Check hardcoded defaults
    if (namespace && this.hardcodedDefaults[namespace]) {
      return this.hardcodedDefaults[namespace][parameterName];
    }

    return this.hardcodedDefaults[parameterName];
  }

  public getAll(namespace?: Namespace): Record<string, any> {
    const result: Record<string, any> = {};

    // Merge all layers
    const namespaces = namespace ? [namespace] : ["image", "audio", "video"];

    for (const ns of namespaces) {
      const nsDefaults = this.hardcodedDefaults[ns] || {};
      const nsConfig = this.configDefaults[ns] || {};
      const nsRuntime = this.runtimeDefaults[ns] || {};

      result[ns] = {
        ...nsDefaults,
        ...nsConfig,
        ...nsRuntime,
      };
    }

    return result;
  }

  public set(parameterName: string, value: any, persist: boolean = false): void {
    this.runtimeDefaults[parameterName] = value;

    if (persist) {
      this._persistConfig();
    }
  }

  public setNamespaceDefaults(namespace: Namespace, defaults: Record<string, any>, persist: boolean = false): void {
    this.runtimeDefaults[namespace] = {
      ...(this.runtimeDefaults[namespace] || {}),
      ...defaults,
    };

    if (persist) {
      this._persistConfig();
    }
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

  private _persistConfig(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const config: ConfigData = {
        defaults: {},
      };

      // Merge runtime defaults into config
      for (const [key, value] of Object.entries(this.runtimeDefaults)) {
        if (["image", "audio", "video"].includes(key)) {
          config.defaults[key] = value;
        } else {
          // Put non-namespace defaults in image by default
          if (!config.defaults.image) {
            config.defaults.image = {};
          }
          config.defaults.image[key] = value;
        }
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf-8");
      console.info(`Persisted defaults to ${this.configPath}`);
    } catch (error) {
      console.error("Failed to persist defaults:", error);
    }
  }

  private _parseEnvValue(value: string): any {
    // Try to parse as number
    if (!isNaN(Number(value))) {
      return Number(value);
    }

    // Try to parse as boolean
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;

    // Return as string
    return value;
  }
}
