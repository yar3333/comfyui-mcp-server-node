import { AssetRecord } from '../models/asset';
import { AssetRegistry } from '../managers/asset_registry';
import { ComfyUIClient } from '../comfyui_client';
import axios from 'axios';
import { encodePreviewForMcp } from '../asset_processor';

export interface AssetResponse {
  asset_id: string;
  asset_url: string;
  filename: string;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  bytes_size: number | null;
  prompt_id: string;
  inline_preview?: string;
  inline_preview_mime_type?: string;
}

export async function registerAndBuildResponse(
  assetRegistry: AssetRegistry,
  clientResult: Record<string, any>,
  workflowId: string,
  returnInlinePreview: boolean = false,
  sessionId: string | null = null
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
    sessionId
  );

  const response: AssetResponse = {
    asset_id: asset.asset_id,
    asset_url: assetRegistry.getAssetUrl(asset),
    filename: asset.filename,
    width: asset.width,
    height: asset.height,
    mime_type: asset.mime_type,
    bytes_size: asset.bytes_size,
    prompt_id: asset.prompt_id,
  };

  // Fetch inline preview if requested
  if (returnInlinePreview && asset.mime_type?.startsWith('image/')) {
    try {
      const imageUrl = assetRegistry.getAssetUrl(asset);
      const imgResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      
      const imageBytes = Buffer.from(imgResponse.data);
      const encoded = await encodePreviewForMcp(imageBytes, 1024);
      
      response.inline_preview = encoded.base64;
      response.inline_preview_mime_type = encoded.mime_type;
    } catch (error) {
      console.warn('Failed to fetch inline preview:', error);
    }
  }

  return response;
}
