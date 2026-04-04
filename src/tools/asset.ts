import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AssetRegistry } from "../managers/asset_registry";
import axios from "axios";
import { encodePreviewForMcp } from "../asset_processor";
import * as z from "zod";

export function registerAssetTools(server: McpServer, assetRegistry: AssetRegistry): void {
  server.registerTool(
    "view_image",
    {
      description: "View a generated image inline in the chat",
      inputSchema: z.object({
        asset_id: z.string().describe("ID of the asset to view"),
        mode: z.string().optional().describe("View mode: thumb or metadata"),
        max_dim: z.number().optional().describe("Maximum dimension for resizing"),
        max_b64_chars: z.number().optional().describe("Maximum base64 character budget"),
      }),
    },
    async (args: any) => {
      try {
        const asset = assetRegistry.getAsset(args.asset_id);
        if (!asset) {
          return { content: [{ type: "text", text: `Asset not found: ${args.asset_id}` }], isError: true };
        }

        if (!asset.mime_type?.startsWith("image/")) {
          return { content: [{ type: "text", text: `Asset is not an image: ${args.asset_id}` }], isError: true };
        }

        const imageUrl = assetRegistry.getAssetUrl(asset);
        const imgResponse = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 10000 });
        const imageBytes = Buffer.from(imgResponse.data);
        const mode = args.mode || "thumb";

        if (mode === "metadata") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    asset_id: asset.asset_id,
                    filename: asset.filename,
                    width: asset.width,
                    height: asset.height,
                    mime_type: asset.mime_type,
                    bytes_size: asset.bytes_size,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const maxDim = args.max_dim || 1024;
        const maxB64Chars = args.max_b64_chars || 100000;
        const encoded = await encodePreviewForMcp(imageBytes, maxDim, maxB64Chars);

        return {
          content: [
            {
              type: "text",
              text: `![${asset.filename}](data:${encoded.mime_type};base64,${encoded.base64})`,
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error viewing image: ${error.message}` }], isError: true };
      }
    },
  );
}
