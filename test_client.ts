import * as http from "http";

const MCP_SERVER_URL = "http://127.0.0.1:9000/mcp";

let sessionId: string | null = null;

interface JsonRpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: any;
}

async function sendRequest(method: string, params?: Record<string, any>): Promise<JsonRpcResponse> {
  const request: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: Date.now(),
    method,
    params,
  };

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(request);
    const url = new URL(MCP_SERVER_URL);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Content-Length": Buffer.byteLength(body).toString(),
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : undefined,
        path: url.pathname,
        method: "POST",
        headers,
        timeout: 30000,
      },
      (res) => {
        const sid = res.headers["mcp-session-id"];
        if (sid && !sessionId) {
          sessionId = typeof sid === "string" ? sid : sid[0];
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              // Try direct JSON parse
              const data = JSON.parse(rawBody);
              if (Array.isArray(data)) {
                // Return last message for array (notifications first, then response)
                resolve(data[data.length - 1]);
              } else {
                resolve(data);
              }
            } catch {
              // Try parsing SSE
              const messages = parseSSE(rawBody);
              if (messages.length === 0) {
                resolve({ jsonrpc: "2.0", id: request.id, result: null });
              } else {
                // Return last message
                resolve(messages[messages.length - 1]);
              }
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${rawBody}`));
          }
        });
        res.on("error", (err) => reject(err));
      },
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(body);
    req.end();
  });
}

function parseSSE(data: string): JsonRpcResponse[] {
  const results: JsonRpcResponse[] = [];
  const lines = data.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const jsonStr = line.slice(5).trim();
      try {
        results.push(JSON.parse(jsonStr));
      } catch {
        // skip
      }
    }
  }
  return results;
}

async function initialize(): Promise<void> {
  console.log("Initializing MCP session...");
  const response = await sendRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  });
  console.log("Server info:", JSON.stringify(response.result?.serverInfo, null, 2));

  // Send initialized notification
  await sendRequest("notifications/initialized");
  console.log("MCP session established.\n");
}

async function listTools(): Promise<void> {
  console.log("\n=== Listing available tools ===\n");
  const response = await sendRequest("tools/list");

  if ("error" in response && response.error) {
    console.error("Error:", response.error);
    return;
  }

  const tools = response.result?.tools || [];
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }
  console.log(`\nTotal: ${tools.length} tools\n`);
}

async function getDefaults(): Promise<void> {
  console.log("\n=== Getting defaults ===\n");
  const response = await sendRequest("tools/call", {
    name: "get_defaults",
    arguments: {},
  });

  if ("error" in response && response.error) {
    console.error("Error:", response.error);
    return;
  }

  console.log(response.result?.content?.[0]?.text || "No defaults");
}

async function generateImage(prompt: string): Promise<void> {
  console.log(`\n=== Generating image: "${prompt}" ===\n`);
  const response = await sendRequest("tools/call", {
    name: "generate_image",
    arguments: {
      prompt,
      return_inline_preview: false,
    },
  });

  if ("error" in response && response.error) {
    console.error("Error:", response.error);
    return;
  }

  console.log(response.result?.content?.[0]?.text || "No result");
}

async function main(): Promise<void> {
  console.log("ComfyUI MCP Server Test Client");
  console.log("==============================\n");

  try {
    // Step 1: Initialize MCP session
    await initialize();

    // Step 2: List tools
    await listTools();

    // Step 3: Get defaults
    await getDefaults();

    // Step 4: Generate image if prompt provided
    const promptArg = process.argv[2];
    if (promptArg) {
      await generateImage(promptArg);
    } else {
      console.log('\nNo prompt provided. Usage: npx ts-node test_client.ts "your prompt"');
    }
  } catch (error: any) {
    console.error("Test client error:", error.message);
    process.exit(1);
  }
}

main();
