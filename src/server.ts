import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import axios from "axios";

import { ComfyUIClient } from "./comfyui_client";
import { WorkflowManager } from "./managers/workflow_manager";
import { DefaultsManager } from "./managers/defaults_manager";
import { AssetRegistry } from "./managers/asset_registry";
import { PublishConfig, PublishManager } from "./managers/publish_manager";
import { registerConfigurationTools } from "./tools/configuration";
import { registerWorkflowTools } from "./tools/workflow";
import { registerAssetTools } from "./tools/asset";
import { registerWorkflowGenerationTools, registerRegenerateTool } from "./tools/generation";
import { registerJobTools } from "./tools/job";
import { registerPublishTools } from "./tools/publish";

// Configuration
const WORKFLOW_DIR = process.env.COMFY_MCP_WORKFLOW_DIR || path.join(__dirname, "..", "workflows");
const ASSET_TTL_HOURS = parseInt(process.env.COMFY_MCP_ASSET_TTL_HOURS || "24", 10);
const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const COMFYUI_MAX_RETRIES = 5;
const COMFYUI_INITIAL_DELAY = 2000; // ms
const COMFYUI_MAX_DELAY = 16000; // ms
const COMFYUI_OUTPUT_ROOT = process.env.COMFYUI_OUTPUT_ROOT || null;
const PORT = parseInt(process.env.COMFY_MCP_PORT || "9000", 10);

function printStartupBanner(): void {
  console.log("\n" + "=".repeat(70));
  console.log("[*] ComfyUI-MCP-Server".padStart(35).padEnd(70));
  console.log("=".repeat(70));
  console.log(`  Connecting to ComfyUI at: ${COMFYUI_URL}`);
  console.log(`  Workflow directory: ${WORKFLOW_DIR}`);
  console.log(`  Asset TTL: ${ASSET_TTL_HOURS} hours`);
  console.log("=".repeat(70) + "\n");
}

async function checkComfyuiAvailable(baseUrl: string): Promise<boolean> {
  try {
    const response = await axios.get(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
      timeout: 5000,
    });

    if (response.status === 200) {
      const data = response.data;
      const checkpointInfo = data["CheckpointLoaderSimple"];
      if (typeof checkpointInfo === "object") {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function waitForComfyui(
  baseUrl: string,
  maxRetries: number = COMFYUI_MAX_RETRIES,
  initialDelay: number = COMFYUI_INITIAL_DELAY,
  maxDelay: number = COMFYUI_MAX_DELAY,
): Promise<boolean> {
  console.log("\n" + "=".repeat(70));
  console.log("[!]  ALERT: ComfyUI is not available!");
  console.log("=".repeat(70));
  console.log(`  Checking for ComfyUI at: ${baseUrl}`);
  console.log(`  Waiting for ComfyUI to start (will retry ${maxRetries} times)...`);
  console.log("=".repeat(70) + "\n");

  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.info(`ComfyUI availability check (attempt ${attempt}/${maxRetries})...`);

    if (await checkComfyuiAvailable(baseUrl)) {
      console.log("\n" + "=".repeat(70));
      console.log("[+] ComfyUI is now available!");
      console.log("=".repeat(70) + "\n");
      console.info("ComfyUI is available, proceeding with server startup");
      return true;
    }

    if (attempt < maxRetries) {
      console.log(`[...] Attempt ${attempt}/${maxRetries} failed. Retrying in ${(delay / 1000).toFixed(1)} seconds...`);
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelay);
    } else {
      console.log(`[X] Attempt ${attempt}/${maxRetries} failed. No more retries.`);
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  printStartupBanner();

  // Check ComfyUI availability
  let comfyuiAvailable = await checkComfyuiAvailable(COMFYUI_URL);

  if (!comfyuiAvailable) {
    comfyuiAvailable = await waitForComfyui(COMFYUI_URL);

    if (!comfyuiAvailable) {
      console.log("\n" + "=".repeat(70));
      console.log("[X] ERROR: ComfyUI is not available after all retry attempts!");
      console.log("=".repeat(70));
      console.log(`  Please ensure ComfyUI is running at: ${COMFYUI_URL}`);
      console.log("  Start ComfyUI first, then restart this server.");
      console.log("=".repeat(70) + "\n");
      process.exit(1);
    }
  }

  // Initialize global instances
  const comfyuiClient = new ComfyUIClient(COMFYUI_URL);
  const workflowManager = new WorkflowManager(WORKFLOW_DIR);
  const defaultsManager = new DefaultsManager(comfyuiClient);
  const assetRegistry = new AssetRegistry(ASSET_TTL_HOURS, COMFYUI_URL);

  // Initialize defaults
  await defaultsManager.initialize();

  // Publish manager
  let publishManager: PublishManager | null = null;
  try {
    const publishConfig = new PublishConfig(COMFYUI_OUTPUT_ROOT, COMFYUI_URL);
    publishManager = new PublishManager(publishConfig);
    console.info(
      `Publish manager initialized with project_root=${publishConfig.projectRoot} (method: ${publishConfig.projectRootMethod})`,
    );
    console.info(`Publish root: ${publishConfig.publishRoot}`);
    if (publishConfig.comfyuiOutputRoot) {
      console.info(
        `ComfyUI output root: ${publishConfig.comfyuiOutputRoot} (method: ${publishConfig.comfyuiOutputMethod})`,
      );
    } else {
      console.info(`ComfyUI output root: not configured (tried ${publishConfig.comfyuiTriedPaths.length} paths)`);
    }
  } catch (error) {
    console.warn(`Failed to initialize publish manager: ${error}. Publishing features may be unavailable.`);
  }

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
  registerConfigurationTools(server, comfyuiClient, defaultsManager);
  registerWorkflowTools(server, workflowManager, comfyuiClient, defaultsManager, assetRegistry);
  registerAssetTools(server, assetRegistry);
  registerWorkflowGenerationTools(server, workflowManager, comfyuiClient, defaultsManager, assetRegistry);
  registerRegenerateTool(server, comfyuiClient, assetRegistry);
  registerJobTools(server, comfyuiClient, assetRegistry);

  if (publishManager) {
    registerPublishTools(server, assetRegistry, publishManager);
  } else {
    console.error("Publish manager not available - publish tools will not be registered");
  }

  // Check if running as MCP command (stdio) or standalone (streamable-http)
  const useStdio = process.argv.includes("--stdio");

  if (useStdio) {
    console.log("\n" + "=".repeat(70));
    console.log("[+] Server Ready".padStart(35).padEnd(70));
    console.log("=".repeat(70));
    console.log(`  Transport: stdio (for MCP clients)`);
    console.log(`[+] ComfyUI verified at: ${COMFYUI_URL}`);
    console.log("=".repeat(70) + "\n");
    console.info("Starting MCP server with stdio transport (for MCP clients)");

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } else {
    console.log("\n" + "=".repeat(70));
    console.log("[+] Server Ready".padStart(35).padEnd(70));
    console.log("=".repeat(70));
    console.log(`  Transport: streamable-http`);
    console.log(`  Endpoint: http://127.0.0.1:${PORT}/mcp`);
    console.log(`[+] ComfyUI verified at: ${COMFYUI_URL}`);
    console.log("=".repeat(70) + "\n");
    console.info(`Starting MCP server with streamable-http transport on http://127.0.0.1:${PORT}/mcp`);

    const transport = new StreamableHTTPServerTransport();

    await server.connect(transport);

    // Start HTTP server
    const http = await import("http");
    const httpServer = http.createServer(async (req, res) => {
      if (req.url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
        await transport.handleRequest(req, res);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    httpServer.listen(PORT, "127.0.0.1", () => {
      console.info(`HTTP server listening on port ${PORT}`);
    });
  }
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
