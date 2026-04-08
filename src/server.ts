#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "path";

import { ComfyUIClient } from "./comfyui_client";
import { WorkflowManager } from "./managers/workflow_manager";
import { AssetRegistry } from "./managers/asset_registry";
import { registerConfigurationTools } from "./tools/configuration";
import { registerWorkflowTools } from "./tools/workflow";
import { registerAssetTools } from "./tools/asset";
import { registerWorkflowGenerationTools, registerRegenerateTool } from "./tools/generation";
import { registerJobTools } from "./tools/job";

// Configuration
const WORKFLOW_DIR = process.env.COMFY_MCP_WORKFLOW_DIR || path.join(__dirname, "..", "workflows");
const ASSET_TTL_HOURS = parseInt(process.env.COMFY_MCP_ASSET_TTL_HOURS || "24", 10);
const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";

function printStartupBanner(): void {
  console.log("\n" + "=".repeat(70));
  console.log("[*] ComfyUI-MCP-Server-node".padStart(35).padEnd(70));
  console.log("=".repeat(70));
  console.log(`  ComfyUI URL: ${COMFYUI_URL} (connection on first tool use)`);
  console.log(`  Workflow directory: ${WORKFLOW_DIR}`);
  console.log(`  Asset TTL: ${ASSET_TTL_HOURS} hours`);
  console.log("=".repeat(70) + "\n");
}

async function main(): Promise<void> {
  printStartupBanner();

  // Initialize global instances
  const comfyuiClient = new ComfyUIClient(COMFYUI_URL);
  const workflowManager = new WorkflowManager(WORKFLOW_DIR);
  const assetRegistry = new AssetRegistry(ASSET_TTL_HOURS, COMFYUI_URL);

  // Create MCP server
  const server = new McpServer(
    {
      name: "ComfyUI_MCP_Server",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  // Register all MCP tools
  registerConfigurationTools(server, comfyuiClient);
  registerWorkflowTools(server, workflowManager, comfyuiClient, assetRegistry);
  registerAssetTools(server, assetRegistry);
  registerWorkflowGenerationTools(server, workflowManager, comfyuiClient, assetRegistry);
  registerRegenerateTool(server, comfyuiClient, assetRegistry);
  registerJobTools(server, comfyuiClient, assetRegistry);

  // Start MCP server with stdio transport
  console.log("\n" + "=".repeat(70));
  console.log("[+] Server Ready".padStart(35).padEnd(70));
  console.log("=".repeat(70));
  console.log(`  Transport: stdio (for MCP clients)`);
  console.log(`  ComfyUI will be connected on first tool invocation`);
  console.log("=".repeat(70) + "\n");
  console.info("Starting MCP server with stdio transport (for MCP clients)");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[*] Server stopped.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[*] Server stopped.");
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
