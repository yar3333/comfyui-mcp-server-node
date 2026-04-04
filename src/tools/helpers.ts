import { AssetRecord } from "../models/asset";
import { AssetRegistry } from "../managers/asset_registry";
import { ComfyUIClient } from "../comfyui_client";
import axios from "axios";
import { encodePreviewForMcp } from "../asset_processor";

export interface AssetResponse {
  asset_id: string;
  asset_url: string;
  image_url: string; // Backward compatibility
  filename: string;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  bytes_size: number | null;
  prompt_id: string;
  tool: string; // Tool name that generated this
  inline_preview?: string;
  inline_preview_mime_type?: string;
}

export async function registerAndBuildResponse(
  assetRegistry: AssetRegistry,
  clientResult: Record<string, any>,
  workflowId: string,
  returnInlinePreview: boolean = false,
  sessionId: string | null = null,
  toolName: string = "generate_image",
): Promise<AssetResponse> {
  const asset = assetRegistry.registerAsset(
    clientResult.filename,
    clientResult.subfolder,
    clientResult.folder_type,
    clientResult.prompt_id,
    workflowId,
    clientResult.asset_metadata,
    clientResult.comfy_history,
    clientResult.submitted_workflow,
    sessionId,
  );

  const assetUrl = assetRegistry.getAssetUrl(asset);

  const response: AssetResponse = {
    asset_id: asset.asset_id,
    asset_url: assetUrl,
    image_url: assetUrl, // Backward compatibility
    filename: asset.filename,
    width: asset.width,
    height: asset.height,
    mime_type: asset.mime_type,
    bytes_size: asset.bytes_size,
    prompt_id: asset.prompt_id,
    tool: toolName,
  };

  // Fetch inline preview if requested
  if (returnInlinePreview && asset.mime_type?.startsWith("image/")) {
    try {
      const imgResponse = await axios.get(assetUrl, {
        responseType: "arraybuffer",
        timeout: 10000,
      });

      const imageBytes = Buffer.from(imgResponse.data);
      const encoded = await encodePreviewForMcp(imageBytes, 256);

      response.inline_preview = encoded.base64;
      response.inline_preview_mime_type = encoded.mime_type;
    } catch (error) {
      console.warn("Failed to fetch inline preview:", error);
    }
  }

  return response;
}
