import { v4 as uuidv4 } from "uuid";
import { AssetRecord } from "../models/asset";

export class AssetRegistry {
  private ttlHours: number;
  private comfyuiBaseUrl: string;
  private assets: Map<string, AssetRecord> = new Map();

  // Indexes for O(1) lookups
  private byFilename: Map<string, Set<string>> = new Map();
  private byWorkflow: Map<string, Set<string>> = new Map();
  private bySession: Map<string, Set<string>> = new Map();

  private lock: Promise<void> = Promise.resolve();

  constructor(ttlHours: number, comfyuiBaseUrl: string) {
    this.ttlHours = ttlHours;
    this.comfyuiBaseUrl = comfyuiBaseUrl;
  }

  public registerAsset(
    filename: string,
    subfolder: string,
    folderType: string,
    promptId: string,
    workflowId: string,
    assetMetadata: Record<string, any>,
    comfyHistory: Record<string, any> | null,
    submittedWorkflow: Record<string, any> | null,
    sessionId: string | null = null,
  ): AssetRecord {
    const assetId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlHours * 60 * 60 * 1000);

    const asset: AssetRecord = {
      asset_id: assetId,
      filename,
      subfolder,
      folder_type: folderType,
      prompt_id: promptId,
      workflow_id: workflowId,
      created_at: now,
      expires_at: expiresAt,
      mime_type: assetMetadata.mime_type || null,
      width: assetMetadata.width || null,
      height: assetMetadata.height || null,
      bytes_size: assetMetadata.bytes_size || null,
      comfy_history: comfyHistory,
      submitted_workflow: submittedWorkflow,
      metadata: assetMetadata,
      session_id: sessionId,
    };

    this.assets.set(assetId, asset);

    // Update indexes
    const stableKey = this._getStableKey(filename, subfolder, folderType);
    if (!this.byFilename.has(stableKey)) {
      this.byFilename.set(stableKey, new Set());
    }
    this.byFilename.get(stableKey)!.add(assetId);

    if (!this.byWorkflow.has(workflowId)) {
      this.byWorkflow.set(workflowId, new Set());
    }
    this.byWorkflow.get(workflowId)!.add(assetId);

    if (sessionId) {
      if (!this.bySession.has(sessionId)) {
        this.bySession.set(sessionId, new Set());
      }
      this.bySession.get(sessionId)!.add(assetId);
    }

    return asset;
  }

  public getAsset(assetId: string): AssetRecord | null {
    const asset = this.assets.get(assetId);
    if (!asset) return null;

    // Check expiration
    if (new Date() > asset.expires_at) {
      this.assets.delete(assetId);
      return null;
    }

    return asset;
  }

  public getAssetByUrl(filename: string, subfolder: string, folderType: string): AssetRecord | null {
    const stableKey = this._getStableKey(filename, subfolder, folderType);
    const assetIds = this.byFilename.get(stableKey);
    if (!assetIds || assetIds.size === 0) return null;

    // Return the most recent asset
    const latestAssetId = Array.from(assetIds).pop()!;
    return this.getAsset(latestAssetId);
  }

  public listAssets(limit: number = 100, workflowId?: string | null, sessionId?: string | null): AssetRecord[] {
    let assetIds: Set<string>;

    if (workflowId) {
      assetIds = this.byWorkflow.get(workflowId) || new Set();
    } else if (sessionId) {
      assetIds = this.bySession.get(sessionId) || new Set();
    } else {
      assetIds = new Set(this.assets.keys());
    }

    // Filter expired assets
    const validAssetIds = Array.from(assetIds).filter((id) => {
      const asset = this.assets.get(id);
      return asset && new Date() <= asset.expires_at;
    });

    // Sort by creation time (newest first) and limit
    const sorted = validAssetIds
      .map((id) => this.assets.get(id)!)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);

    return sorted;
  }

  public deleteExpiredAssets(): number {
    const now = new Date();
    let deleted = 0;

    for (const [assetId, asset] of this.assets.entries()) {
      if (now > asset.expires_at) {
        this.assets.delete(assetId);

        // Remove from indexes
        const stableKey = this._getStableKey(asset.filename, asset.subfolder, asset.folder_type);
        this.byFilename.get(stableKey)?.delete(assetId);
        this.byWorkflow.get(asset.workflow_id)?.delete(assetId);
        if (asset.session_id) {
          this.bySession.get(asset.session_id)?.delete(assetId);
        }

        deleted++;
      }
    }

    return deleted;
  }

  public getAssetUrl(asset: AssetRecord): string {
    const encodedFilename = encodeURIComponent(asset.filename);
    const encodedSubfolder = asset.subfolder ? encodeURIComponent(asset.subfolder) : "";

    if (encodedSubfolder) {
      return `${this.comfyuiBaseUrl}/view?filename=${encodedFilename}&subfolder=${encodedSubfolder}&type=${asset.folder_type}`;
    }
    return `${this.comfyuiBaseUrl}/view?filename=${encodedFilename}&type=${asset.folder_type}`;
  }

  private _getStableKey(filename: string, subfolder: string, folderType: string): string {
    return `${folderType}/${subfolder || ""}/${filename}`;
  }
}
