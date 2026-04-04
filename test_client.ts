import axios from 'axios';
import * as readline from 'readline';

const MCP_SERVER_URL = 'http://127.0.0.1:9000/mcp';

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
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };

  try {
    const response = await axios.post(MCP_SERVER_URL, request, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    return response.data;
  } catch (error: any) {
    console.error('Request failed:', error.message);
    throw error;
  }
}

async function listTools(): Promise<void> {
  console.log('\n=== Listing available tools ===\n');
  const response = await sendRequest('tools/list');
  
  if (response.error) {
    console.error('Error:', response.error);
    return;
  }

  const tools = response.result?.tools || [];
  for (const tool of tools) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }
  console.log(`\nTotal: ${tools.length} tools\n`);
}

async function getDefaults(): Promise<void> {
  console.log('\n=== Getting defaults ===\n');
  const response = await sendRequest('tools/call', {
    name: 'get_defaults',
    arguments: {},
  });

  if (response.error) {
    console.error('Error:', response.error);
    return;
  }

  console.log(response.result?.content?.[0]?.text || 'No defaults');
}

async function generateImage(prompt: string): Promise<void> {
  console.log(`\n=== Generating image: "${prompt}" ===\n`);
  const response = await sendRequest('tools/call', {
    name: 'generate_image',
    arguments: {
      prompt,
    },
  });

  if (response.error) {
    console.error('Error:', response.error);
    return;
  }

  console.log(response.result?.content?.[0]?.text || 'No result');
}

async function main(): Promise<void> {
  console.log('ComfyUI MCP Server Test Client');
  console.log('==============================\n');

  try {
    // List tools
    await listTools();

    // Get defaults
    await getDefaults();

    // Generate image if prompt provided
    const prompt = process.argv[2];
    if (prompt) {
      await generateImage(prompt);
    } else {
      console.log('No prompt provided. Usage: node dist/test_client.js "your prompt here"');
    }
  } catch (error) {
    console.error('Test client error:', error);
    process.exit(1);
  }
}

main();
