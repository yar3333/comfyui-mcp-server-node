import axios, { AxiosInstance } from "axios";
import { getImageMetadata } from "./asset_processor";

interface AssetInfo {
  filename: string;
  subfolder: string;
  type: string;
  asset_url: string;
}

interface AssetMetadata {
  mime_type: string | null;
  width: number | null;
  height: number | null;
  bytes_size: number | null;
}

interface WorkflowResult {
  status?: "running";
  prompt_id: string;
  message?: string;
  asset_url?: string;
  filename?: string;
  subfolder?: string;
  folder_type?: string;
  raw_outputs?: Record<string, any>;
  asset_metadata?: AssetMetadata;
  comfy_history?: Record<string, any> | null;
  submitted_workflow?: Record<string, any>;
}

export class ComfyUIClient {
  private readonly client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
    });
  }

  async getAvailableCheckpointModels(): Promise<string[]> {
    try {
      const response: any = await this.client.get("/object_info/CheckpointLoaderSimple");

      const models: string[] = [];

      // Extract checkpoint models
      if (response.status === "fulfilled") {
        try {
          const data = response.value.data;
          const checkpointInfo = data["CheckpointLoaderSimple"];
          if (checkpointInfo?.input?.required?.ckpt_name) {
            const ckptNameInfo = checkpointInfo.input.required.ckpt_name;
            const checkpointModels = Array.isArray(ckptNameInfo[0]) ? ckptNameInfo[0] : ckptNameInfo;
            models.push(...(checkpointModels as string[]));
          }
        } catch (error) {
          console.debug("Failed to parse checkpoint models");
        }
      }

      if (models.length > 0) {
        console.info("Available models:", models);
      } else {
        console.warn("No models found");
      }

      return models;
    } catch (error) {
      console.warn("Error fetching models:", error);
      return [];
    }
  }

  async getAvailableUnetModels(): Promise<string[]> {
    try {
      const response: any = await this.client.get("/object_info/UNETLoader");

      const models: string[] = [];

      // Extract UNet/diffusion models
      if (response.status === "fulfilled") {
        try {
          const data = response.value.data;
          const unetInfo = data["UNETLoader"];
          if (unetInfo?.input?.required?.unet_name) {
            const unetNameInfo = unetInfo.input.required.unet_name;
            const unetModels = Array.isArray(unetNameInfo[0]) ? unetNameInfo[0] : unetNameInfo;
            models.push(...(unetModels as string[]));
          }
        } catch (error) {
          console.debug("Failed to parse UNet models");
        }
      }

      if (models.length > 0) {
        console.info("Available models:", models);
      } else {
        console.warn("No models found");
      }

      return models;
    } catch (error) {
      console.warn("Error fetching models:", error);
      return [];
    }
  }
  async getAvailableUnetGgufModels(): Promise<string[]> {
    try {
      const response: any = await this.client.get("/object_info/UnetLoaderGGUF");

      const models: string[] = [];

      // Extract UNet/diffusion models
      if (response.status === "fulfilled") {
        try {
          const data = response.value.data;
          const unetGgufInfo = data["UnetLoaderGGUF"];
          if (unetGgufInfo?.input?.required?.unet_name) {
            const unetNameInfo = unetGgufInfo.input.required.unet_name;
            const unetGgufModels = Array.isArray(unetNameInfo[0]) ? unetNameInfo[0] : unetNameInfo;
            models.push(...(unetGgufModels as string[]));
          }
        } catch (error) {
          console.debug("Failed to parse UNetGguf models");
        }
      }

      if (models.length > 0) {
        console.info("Available models:", models);
      } else {
        console.warn("No models found");
      }

      return models;
    } catch (error) {
      console.warn("Error fetching models:", error);
      return [];
    }
  }

  public async runCustomWorkflow(
    workflow: Record<string, any>,
    preferredOutputKeys: string[] = ["images", "image", "gifs", "gif", "audio", "audios", "files"],
    maxAttempts: number = 30,
  ): Promise<WorkflowResult> {
    const promptId = await this._queueWorkflow(workflow);
    const outputs = await this._waitForPrompt(promptId, maxAttempts);

    // If outputs is None, the workflow is still running (timeout).
    if (outputs === null) {
      return {
        status: "running",
        prompt_id: promptId,
        message: `Workflow still running after ${maxAttempts}s. Use get_job(prompt_id='${promptId}') to poll for completion.`,
      };
    }

    const assetInfo = this._extractFirstAssetInfo(outputs, preferredOutputKeys);
    const assetUrl = assetInfo.asset_url;

    const assetMetadata = await this._getAssetMetadata(assetUrl, outputs, preferredOutputKeys, workflow);

    let comfyHistory: Record<string, any> | null = null;
    try {
      const history = await this.getHistory(promptId);
      comfyHistory = history[promptId] || null;
    } catch (error) {
      console.warn(`Failed to fetch history snapshot for ${promptId}:`, error);
    }

    return {
      asset_url: assetUrl,
      filename: assetInfo.filename,
      subfolder: assetInfo.subfolder,
      folder_type: assetInfo.type,
      prompt_id: promptId,
      raw_outputs: outputs,
      asset_metadata: assetMetadata,
      comfy_history: comfyHistory,
      submitted_workflow: workflow,
    };
  }

  private async _queueWorkflow(workflow: Record<string, any>): Promise<string> {
    console.info("Submitting workflow to ComfyUI...");
    const response = await this.client.post("/prompt", { prompt: workflow });

    if (response.status !== 200) {
      throw new Error(`Failed to queue workflow: ${response.status} - ${response.statusText}`);
    }

    const promptId = response.data.prompt_id;
    if (!promptId) {
      throw new Error("Response missing prompt_id");
    }

    console.info(`Queued workflow with prompt_id: ${promptId}`);
    return promptId;
  }

  private async _waitForPrompt(promptId: string, maxAttempts: number = 30): Promise<Record<string, any> | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.client.get(`/history/${promptId}`);

        if (response.status !== 200) {
          console.warn(`History endpoint returned ${response.status} on attempt ${attempt + 1}`);
          await this._sleep(1000);
          continue;
        }

        const history = response.data;
        if (typeof history !== "object") {
          console.warn(`Invalid history response format on attempt ${attempt + 1}`);
          await this._sleep(1000);
          continue;
        }

        if (!(promptId in history)) {
          if (attempt < maxAttempts - 1) {
            await this._sleep(1000);
            continue;
          } else {
            console.warn(`Prompt ID not found in history. Available IDs: ${Object.keys(history).slice(0, 10)}`);
            await this._sleep(1000);
            continue;
          }
        }

        const promptData = history[promptId];
        if (typeof promptData !== "object") {
          console.warn(`Prompt data is not a dict on attempt ${attempt + 1}`);
          await this._sleep(1000);
          continue;
        }

        // Check for workflow errors
        if ("error" in promptData) {
          throw new Error(`Workflow failed with error: ${JSON.stringify(promptData.error, null, 2)}`);
        }

        const status = promptData.status;
        if (typeof status === "object" && status.completed === false) {
          throw new Error(`Workflow failed: ${JSON.stringify(status.messages || ["Workflow failed"])}`);
        }

        if (typeof status === "object" && status.status_str === "error") {
          const nodeErrors = this._extractNodeErrors(promptData);
          throw new Error(`Workflow execution error: ${nodeErrors}`);
        }

        if (!("outputs" in promptData)) {
          const statusStr = typeof status === "object" ? status.status_str : "";
          const messages = typeof status === "object" ? status.messages : status;

          if (statusStr === "error" || this._hasStatusMessage(messages, "execution_error")) {
            const nodeErrors = this._extractNodeErrors(promptData);
            throw new Error(`Workflow execution failed: ${nodeErrors}`);
          }

          if (this._hasStatusMessage(messages, "execution_success")) {
            console.info("Workflow execution succeeded, waiting for outputs...");
            await this._sleep(3000);
            try {
              const fullHistoryResponse = await this.client.get("/history");
              if (fullHistoryResponse.status === 200) {
                const fullHistory = fullHistoryResponse.data;
                if (promptId in fullHistory) {
                  const fullPromptData = fullHistory[promptId];
                  if ("outputs" in fullPromptData && fullPromptData.outputs) {
                    console.info("Found outputs in full history endpoint");
                    return fullPromptData.outputs;
                  }
                }
              }
            } catch (error) {
              console.debug("Could not fetch full history:", error);
            }
            await this._sleep(1000);
            continue;
          }

          console.warn(`Prompt data missing outputs on attempt ${attempt + 1}`);
          await this._sleep(1000);
          continue;
        }

        const outputs = promptData.outputs;
        if (!outputs || typeof outputs !== "object") {
          const statusStr = typeof status === "object" ? status.status_str : "";
          const messages = typeof status === "object" ? status.messages : status;

          if (statusStr === "error" || this._hasStatusMessage(messages, "execution_error")) {
            const nodeErrors = this._extractNodeErrors(promptData);
            throw new Error(`Workflow execution failed: ${nodeErrors}`);
          }

          if (this._hasStatusMessage(messages, "execution_success")) {
            console.warn("Workflow succeeded but outputs empty. Waiting longer...");
            await this._sleep(2000);
            continue;
          }

          const nodeErrors = this._extractNodeErrors(promptData);
          throw new Error(`Workflow completed but produced no outputs. Diagnostics: ${nodeErrors}`);
        }

        console.info(`Workflow completed. Output nodes: ${Object.keys(outputs)}`);
        return outputs;
      } catch (error: any) {
        if (error.message && error.message.includes("Workflow")) {
          throw error; // Re-raise workflow errors
        }
        console.warn(`Request error on attempt ${attempt + 1}:`, error);
        await this._sleep(1000);
        continue;
      }
    }

    console.warn(`Workflow ${promptId} still running after ${maxAttempts} seconds`);
    return null;
  }

  private _extractFirstAssetInfo(outputs: Record<string, any>, preferredOutputKeys: string[]): AssetInfo {
    for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
      if (typeof nodeOutput !== "object") continue;

      for (const key of preferredOutputKeys) {
        const assets = nodeOutput[key];
        if (!assets || !Array.isArray(assets) || assets.length === 0) continue;

        const asset = assets[0];
        if (typeof asset !== "object") continue;

        const filename = asset.filename;
        if (!filename) continue;

        const subfolder = asset.subfolder || "";
        const outputType = asset.type || "output";

        const encodedFilename = encodeURIComponent(filename);
        const encodedSubfolder = subfolder ? encodeURIComponent(subfolder) : "";

        let assetUrl: string;
        if (encodedSubfolder) {
          assetUrl = `${this.client.defaults.baseURL}/view?filename=${encodedFilename}&subfolder=${encodedSubfolder}&type=${outputType}`;
        } else {
          assetUrl = `${this.client.defaults.baseURL}/view?filename=${encodedFilename}&type=${outputType}`;
        }

        return {
          filename,
          subfolder,
          type: outputType,
          asset_url: assetUrl,
        };
      }
    }

    throw new Error(
      `No outputs matched preferred keys: ${JSON.stringify(preferredOutputKeys)}. ` +
        `Available outputs: ${JSON.stringify(outputs, null, 2)}`,
    );
  }

  private async _getAssetMetadata(
    assetUrl: string,
    outputs: Record<string, any>,
    preferredOutputKeys: string[],
    workflow?: Record<string, any> | null,
  ): Promise<AssetMetadata> {
    const metadata: AssetMetadata = {
      mime_type: null,
      width: null,
      height: null,
      bytes_size: null,
    };

    // Extract MIME type from outputs
    for (const [, nodeOutput] of Object.entries(outputs)) {
      if (typeof nodeOutput !== "object") continue;
      for (const key of preferredOutputKeys) {
        const assets = nodeOutput[key];
        if (assets && Array.isArray(assets) && assets.length > 0) {
          const asset = assets[0];
          if (typeof asset === "object") {
            const filename = asset.filename || "";
            if (filename.endsWith(".png") || filename.endsWith(".PNG")) {
              metadata.mime_type = "image/png";
            } else if (filename.match(/\.(jpg|jpeg|JPG|JPEG)$/)) {
              metadata.mime_type = "image/jpeg";
            } else if (filename.endsWith(".webp") || filename.endsWith(".WEBP")) {
              metadata.mime_type = "image/webp";
            } else if (filename.endsWith(".mp3") || filename.endsWith(".MP3")) {
              metadata.mime_type = "audio/mpeg";
            } else if (filename.endsWith(".mp4") || filename.endsWith(".MP4")) {
              metadata.mime_type = "video/mp4";
            } else if (filename.endsWith(".gif") || filename.endsWith(".GIF")) {
              metadata.mime_type = "image/gif";
            }
            break;
          }
        }
      }
      if (metadata.mime_type) break;
    }

    // Extract dimensions from workflow (EmptyLatentImage node)
    if (workflow && (metadata.width === null || metadata.height === null)) {
      for (const [, nodeData] of Object.entries(workflow)) {
        if (typeof nodeData !== "object") continue;
        if (nodeData.class_type === "EmptyLatentImage") {
          const inputs = nodeData.inputs || {};
          if (metadata.width === null && "width" in inputs) {
            metadata.width = inputs.width;
          }
          if (metadata.height === null && "height" in inputs) {
            metadata.height = inputs.height;
          }
          if (metadata.width !== null && metadata.height !== null) break;
        }
      }
    }

    // Try to fetch headers for size
    try {
      const response = await this.client.head(assetUrl, { timeout: 5000 });
      if (response.status === 200) {
        const contentLength = response.headers["content-length"];
        if (contentLength) {
          metadata.bytes_size = parseInt(contentLength, 10);
        }
        const contentType = response.headers["content-type"];
        if (contentType && !metadata.mime_type) {
          metadata.mime_type = contentType.split(";")[0].trim();
        }
      }
    } catch (error) {
      console.debug("Could not fetch asset metadata:", error);
    }

    // Fallback: Extract image dimensions by analyzing image bytes
    if (metadata.mime_type?.startsWith("image/") && (metadata.width === null || metadata.height === null)) {
      try {
        const imgResponse = await this.client.get(assetUrl, {
          responseType: "arraybuffer",
          timeout: 10000,
        });
        if (imgResponse.status === 200) {
          const imageBytes = Buffer.from(imgResponse.data);
          if (!metadata.bytes_size) {
            metadata.bytes_size = imageBytes.length;
          }
          const imgMetadata = getImageMetadata(imageBytes);
          if (imgMetadata.width && imgMetadata.height) {
            metadata.width = imgMetadata.width;
            metadata.height = imgMetadata.height;
          }
        }
      } catch (error) {
        console.debug("Could not extract image dimensions:", error);
      }
    }

    return metadata;
  }

  public async getQueue(): Promise<Record<string, any>> {
    try {
      const response = await this.client.get("/queue");
      return response.data;
    } catch (error) {
      console.error("Failed to get queue status:", error);
      throw new Error("Failed to get queue status");
    }
  }

  public async getHistory(promptId?: string | null): Promise<Record<string, any>> {
    try {
      const url = promptId ? `/history/${promptId}` : "/history";
      const response = await this.client.get(url);
      return response.data;
    } catch (error) {
      console.error("Failed to get history:", error);
      throw new Error("Failed to get history");
    }
  }

  public async cancelPrompt(promptId: string): Promise<boolean> {
    try {
      const response = await this.client.post("/queue", { delete: [promptId] });
      return response.status === 200;
    } catch (error) {
      console.error("Failed to cancel prompt:", error);
      throw new Error("Failed to cancel prompt");
    }
  }

  private _hasStatusMessage(messages: any, target: string): boolean {
    if (!messages) return false;

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (Array.isArray(msg) && msg.length > 0 && msg[0] === target) return true;
        if (typeof msg === "string" && msg === target) return true;
      }
    }

    return false;
  }

  private _extractNodeErrors(promptData: Record<string, any>): string {
    const parts: string[] = [];

    const status = promptData.status;
    if (typeof status === "object" && status.messages) {
      const messages = status.messages;
      for (const msg of messages) {
        if (Array.isArray(msg) && msg.length >= 2 && msg[0] === "execution_error") {
          const data = typeof msg[1] === "object" ? msg[1] : {};
          const nodeType = data.node_type || "unknown";
          const nodeId = data.node_id || "?";
          const excType = data.exception_type || "Error";
          const excMsg = data.exception_message || "unknown error";
          parts.push(`Node ${nodeId} (${nodeType}): [${excType}] ${excMsg}`);

          const tracebackLines = data.traceback;
          if (Array.isArray(tracebackLines) && tracebackLines.length > 0) {
            for (let i = tracebackLines.length - 1; i >= 0; i--) {
              const line = typeof tracebackLines[i] === "string" ? tracebackLines[i].trim() : "";
              if (line && !line.startsWith("Traceback") && !line.startsWith("File")) {
                parts.push(`  -> ${line}`);
                break;
              }
            }
          }
        }
      }
    }

    if (parts.length === 0 && "error" in promptData) {
      parts.push(`Error: ${JSON.stringify(promptData.error)}`);
    }

    if (parts.length === 0) {
      const statusSummary = JSON.stringify(status, null, 2) || "no status info";
      parts.push(`No detailed error info. Status: ${statusSummary}`);
    }

    return parts.join("; ");
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
