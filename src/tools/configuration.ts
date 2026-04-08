import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyUIClient } from "../comfyui_client";
import * as z from "zod";

export function registerConfigurationTools(server: McpServer, client: ComfyUIClient): void {
  server.registerTool(
    "list_checkpoint_models",
    {
      description: "List available checkpoint models from ComfyUI",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const models = await client.getAvailableCheckpointModels();
        return {
          content: [{ type: "text", text: JSON.stringify(models, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_unet_models",
    {
      description: "List available UNet models in standard (safetensors) format from ComfyUI",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const models = await client.getAvailableUnetModels();
        return {
          content: [{ type: "text", text: JSON.stringify(models, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_unet_gguf_models",
    {
      description: "List available UNet models in GGUF format from ComfyUI",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const models = await client.getAvailableUnetGgufModels();
        return {
          content: [{ type: "text", text: JSON.stringify(models, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
