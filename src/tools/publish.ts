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
    { description: "Get information about the publish system configuration", inputSchema: z.object({}) },
    async () => {
      try {
        const config = publishManager.getConfig();
        const info = {
          project_root: config.projectRoot,
          project_root_method: config.projectRootMethod,
          publish_root: config.publishRoot,
          comfyui_output_root: config.comfyuiOutputRoot,
          comfyui_output_method: config.comfyuiOutputMethod,
          comfyui_url: config.comfyuiUrl,
        };
        return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "set_comfyui_output_root",
    {
      description: "Set the ComfyUI output directory path",
      inputSchema: z.object({ path: z.string().describe("Path to ComfyUI output directory") }),
    },
    async (args: any) => {
      try {
        const config = publishManager.getConfig();
        config.comfyuiOutputRoot = args.path;
        config.comfyuiOutputMethod = "manual";
        return { content: [{ type: "text", text: `ComfyUI output root set to: ${args.path}` }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "publish_asset",
    {
      description: "Publish a generated asset to a web project directory",
      inputSchema: z.object({
        asset_id: z.string().describe("ID of the asset to publish"),
        target_filename: z.string().describe("Target filename for the published asset"),
        manifest_key: z.string().optional().describe("Key to use in manifest.json (optional)"),
        web_optimize: z.boolean().optional().describe("Optimize image for web (WebP compression)"),
        max_bytes: z.number().optional().describe("Maximum file size in bytes (for web optimization)"),
        overwrite: z.boolean().optional().describe("Overwrite existing file"),
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
        const overwrite = args.overwrite || false;

        const result = await publishManager.publishAsset(
          sourcePath,
          args.target_filename,
          args.manifest_key,
          webOptimize,
          args.max_bytes,
          overwrite,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  target_path: result.target_path,
                  size: result.size,
                  manifest_key: result.manifest_key,
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
