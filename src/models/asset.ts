export interface AssetRecord {
  asset_id: string;
  filename: string;
  subfolder: string;
  folder_type: string;
  prompt_id: string;
  workflow_id: string;
  created_at: Date;
  expires_at: Date;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  bytes_size: number | null;
  comfy_history: Record<string, any> | null;
  submitted_workflow: Record<string, any> | null;
  metadata: Record<string, any>;
  session_id: string | null;
}
