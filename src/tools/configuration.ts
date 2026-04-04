import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyUIClient } from "../comfyui_client";
import { DefaultsManager } from "../managers/defaults_manager";
import * as z from "zod";

export function registerConfigurationTools(
  server: McpServer,
  client: ComfyUIClient,
  defaultsManager: DefaultsManager,
): void {
  server.registerTool(
    "list_models",
    {
      description: "List available checkpoint models from ComfyUI",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const models = await client.getAvailableModels();
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
    "get_defaults",
    {
      description: "Get current default values",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const defaults = defaultsManager.getAll();
        return {
          content: [{ type: "text", text: JSON.stringify(defaults, null, 2) }],
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
    "set_defaults",
    {
      description: "Set default values for generation parameters",
      inputSchema: z.object({
        image: z.record(z.string(), z.any()).optional().describe("Default values for image generation"),
        audio: z.record(z.string(), z.any()).optional().describe("Default values for audio generation"),
        video: z.record(z.string(), z.any()).optional().describe("Default values for video generation"),
        persist: z.boolean().optional().describe("Persist defaults to config file"),
      }),
    },
    async (args: any) => {
      try {
        const persist = args.persist || false;
        if (args.image) defaultsManager.setNamespaceDefaults("image", args.image, persist);
        if (args.audio) defaultsManager.setNamespaceDefaults("audio", args.audio, persist);
        if (args.video) defaultsManager.setNamespaceDefaults("video", args.video, persist);
        const defaults = defaultsManager.getAll();
        return {
          content: [
            {
              type: "text",
              text: `Defaults updated successfully${persist ? " and persisted to config" : ""}\n\n${JSON.stringify(defaults, null, 2)}`,
            },
          ],
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
