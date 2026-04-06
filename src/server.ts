#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryEventStore } from "@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js";
import { randomUUID } from "crypto";

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((msg: any) => msg.method === "initialize");
  }
  if (body && typeof body === "object") {
    return (body as any).method === "initialize";
  }
  return false;
}
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
  console.log("[*] ComfyUI-MCP-Server-node".padStart(35).padEnd(70));
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

  // Check if running as HTTP server or stdio (default)
  // Default is stdio for MCP clients (npx, Cursor, Claude Desktop, etc.)
  const useHttp = process.argv.includes("--http");

  if (!useHttp) {
    // Stdio mode (default for MCP clients)
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
    // For streamable-http mode, we create a NEW server+transport per session.
    // Factory function to create a fresh server+transport for each session
    async function createSessionServerAndTransport(sessionAssetRegistry: AssetRegistry): Promise<{
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    }> {
      const sessionComfyuiClient = new ComfyUIClient(COMFYUI_URL);
      const sessionWorkflowManager = new WorkflowManager(WORKFLOW_DIR);
      const sessionDefaultsManager = new DefaultsManager(sessionComfyuiClient);

      const sessionServer = new McpServer({ name: "ComfyUI_MCP_Server", version: "1.0.0" }, { capabilities: {} });

      registerConfigurationTools(sessionServer, sessionComfyuiClient, sessionDefaultsManager);
      registerWorkflowTools(
        sessionServer,
        sessionWorkflowManager,
        sessionComfyuiClient,
        sessionDefaultsManager,
        sessionAssetRegistry,
      );
      registerAssetTools(sessionServer, sessionAssetRegistry);
      registerWorkflowGenerationTools(
        sessionServer,
        sessionWorkflowManager,
        sessionComfyuiClient,
        sessionDefaultsManager,
        sessionAssetRegistry,
      );
      registerRegenerateTool(sessionServer, sessionComfyuiClient, sessionAssetRegistry);
      registerJobTools(sessionServer, sessionComfyuiClient, sessionAssetRegistry);
      if (publishManager) registerPublishTools(sessionServer, sessionAssetRegistry, publishManager);

      const sessionTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore: new InMemoryEventStore(),
        onsessioninitialized: (sid) => {
          console.log(`Session initialized: ${sid}`);
          transports[sid] = { server: sessionServer, transport: sessionTransport };
        },
      });

      // Connect server to transport BEFORE handling requests
      await sessionServer.connect(sessionTransport);

      // Clean up on close
      sessionTransport.onclose = () => {
        const sid = sessionTransport.sessionId;
        if (sid && transports[sid]) {
          console.log(`Session closed: ${sid}`);
          delete transports[sid];
        }
      };

      return { server: sessionServer, transport: sessionTransport };
    }

    const transports: Record<string, { server: McpServer; transport: StreamableHTTPServerTransport }> = {};

    // Start HTTP server
    const http = await import("http");
    const httpServer = http.createServer(async (req, res) => {
      if (req.url !== "/mcp") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
        res.writeHead(405);
        res.end("Method Not Allowed");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      console.log(`[HTTP] ${req.method} ${req.url}`);

      // For POST, parse body
      let parsedBody: unknown;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        try {
          parsedBody = rawBody.trim() ? JSON.parse(rawBody) : undefined;
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
          return;
        }
      }

      try {
        let session: { server: McpServer; transport: StreamableHTTPServerTransport } | undefined;

        if (sessionId && transports[sessionId]) {
          session = transports[sessionId];
        } else if (!sessionId && isInitializeRequest(parsedBody)) {
          session = await createSessionServerAndTransport(assetRegistry);
        }

        if (!session) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "No valid session" }, id: null }));
          return;
        }

        await session.transport.handleRequest(req, res, parsedBody);
      } catch (error: any) {
        console.error("[HTTP] Error:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: error.message }, id: null }));
        }
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
