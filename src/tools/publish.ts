import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AssetRegistry } from "../managers/asset_registry";
import { PublishManager } from "../managers/publish_manager";
import * as path from "path";
import * as z from "zod";

export function registerPublishTools(
  server: McpServer,
  assetRegistry: AssetRegistry,
  publishManager: PublishManager,
): void {
  server.registerTool(
    "get_publish_info",
    {
      description:
        "Show publish status (detected project root, publish dir, ComfyUI output root, and any missing setup)",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const info = publishManager.getPublishInfo();
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "set_comfyui_output_root",
    {
      description:
        "Set ComfyUI output directory (recommended for Comfy Desktop / nonstandard installs; persisted across restarts)",
      inputSchema: z.object({ path: z.string().describe("Path to ComfyUI output directory") }),
    },
    async (args: any) => {
      try {
        const result = publishManager.setComfyuiOutputRoot(args.path);

        if (result.error) {
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "publish_asset",
    {
      description:
        "Publish a generated asset into the project's web directory with deterministic compression (default 600KB)",
      inputSchema: z.object({
        asset_id: z.string().describe("ID of the asset to publish"),
        target_filename: z
          .string()
          .optional()
          .describe("Target filename (required for demo mode, optional for library mode)"),
        manifest_key: z.string().optional().describe("Key to use in manifest.json (library mode)"),
        web_optimize: z.boolean().optional().describe("Optimize image for web (WebP compression)"),
        max_bytes: z.number().optional().describe("Maximum file size in bytes (default: 600000)"),
        overwrite: z.boolean().optional().describe("Overwrite existing file"),
        library_mode: z.boolean().optional().describe("Auto-generate filename from asset_id"),
      }),
    },
    async (args: any) => {
      try {
        const asset = assetRegistry.getAsset(args.asset_id);
        if (!asset) {
          return { content: [{ type: "text", text: `Asset not found: ${args.asset_id}` }], isError: true };
        }

        const config = publishManager.getConfig();
        if (!config.comfyuiOutputRoot) {
          return { content: [{ type: "text", text: "ComfyUI output root not configured" }], isError: true };
        }

        const sourcePath = asset.subfolder
          ? path.join(config.comfyuiOutputRoot, asset.subfolder, asset.filename)
          : path.join(config.comfyuiOutputRoot, asset.filename);

        const webOptimize = args.web_optimize || false;
        const overwrite = args.overwrite !== undefined ? args.overwrite : true;
        const libraryMode = args.library_mode || false;

        const result = await publishManager.publishAsset(
          sourcePath,
          args.target_filename,
          args.manifest_key,
          webOptimize,
          args.max_bytes || 600000,
          overwrite,
          libraryMode,
          asset.asset_id,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  target_path: result.target_path,
                  dest_url: result.dest_url,
                  size: result.size,
                  mime_type: result.mime_type,
                  manifest_key: result.manifest_key,
                  compression_info: result.compression_info,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );
}
