import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyUIClient } from "../comfyui_client";
import { AssetRegistry } from "../managers/asset_registry";
import * as z from "zod";

export function registerJobTools(server: McpServer, client: ComfyUIClient, assetRegistry: AssetRegistry): void {
  server.registerTool(
    "get_queue_status",
    { description: "Get current queue status from ComfyUI", inputSchema: z.object({}) },
    async () => {
      try {
        const queue = await client.getQueue();
        return { content: [{ type: "text", text: JSON.stringify(queue, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_job",
    {
      description: "Get job status by prompt_id",
      inputSchema: z.object({ prompt_id: z.string().describe("The prompt ID of the job") }),
    },
    async (args: any) => {
      try {
        const history = await client.getHistory(args.prompt_id);
        if (!history || !(args.prompt_id in history)) {
          return { content: [{ type: "text", text: `Job not found: ${args.prompt_id}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(history[args.prompt_id], null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_assets",
    {
      description: "List generated assets with optional filtering",
      inputSchema: z.object({
        limit: z.number().optional().describe("Maximum number of assets to return"),
        workflow_id: z.string().optional().describe("Filter by workflow ID"),
        session_id: z.string().optional().describe("Filter by session ID"),
      }),
    },
    async (args: any) => {
      try {
        const limit = args.limit || 100;
        const assets = assetRegistry.listAssets(limit, args.workflow_id || null, args.session_id || null);
        const assetList = assets.map((asset) => ({
          asset_id: asset.asset_id,
          asset_url: assetRegistry.getAssetUrl(asset),
          filename: asset.filename,
          width: asset.width,
          height: asset.height,
          mime_type: asset.mime_type,
          bytes_size: asset.bytes_size,
          workflow_id: asset.workflow_id,
          created_at: asset.created_at.toISOString(),
        }));
        return { content: [{ type: "text", text: JSON.stringify(assetList, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_asset_metadata",
    {
      description: "Get full metadata for a specific asset",
      inputSchema: z.object({ asset_id: z.string().describe("The asset ID") }),
    },
    async (args: any) => {
      try {
        const asset = assetRegistry.getAsset(args.asset_id);
        if (!asset) {
          return { content: [{ type: "text", text: `Asset not found: ${args.asset_id}` }], isError: true };
        }
        const metadata = {
          asset_id: asset.asset_id,
          asset_url: assetRegistry.getAssetUrl(asset),
          filename: asset.filename,
          subfolder: asset.subfolder,
          folder_type: asset.folder_type,
          width: asset.width,
          height: asset.height,
          mime_type: asset.mime_type,
          bytes_size: asset.bytes_size,
          workflow_id: asset.workflow_id,
          prompt_id: asset.prompt_id,
          created_at: asset.created_at.toISOString(),
          expires_at: asset.expires_at.toISOString(),
          comfy_history: asset.comfy_history,
          submitted_workflow: asset.submitted_workflow,
        };
        return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "cancel_job",
    {
      description: "Cancel a running job by prompt_id",
      inputSchema: z.object({ prompt_id: z.string().describe("The prompt ID of the job to cancel") }),
    },
    async (args: any) => {
      try {
        const cancelled = await client.cancelPrompt(args.prompt_id);
        return {
          content: [
            {
              type: "text",
              text: cancelled
                ? `Job ${args.prompt_id} cancelled successfully`
                : `Failed to cancel job ${args.prompt_id}`,
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );
}
