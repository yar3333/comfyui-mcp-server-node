# MCP Configuration for Cursor

This file explains how to configure Cursor to connect to the ComfyUI MCP Server (Node.js/TypeScript). For general usage instructions, see [README.md](../README.md).

## Connection Configuration

Cursor connects to the MCP server via stdio. The server process is automatically started and managed by Cursor.

**Configuration:**

```json
{
  "mcpServers": {
    "comfyui-mcp-server-node": {
      "command": "node",
      "args": ["/path/to/comfyui-mcp-server-node/dist/server.js"],
      "env": {
        "COMFYUI_URL": "http://localhost:8188"
      }
    }
  }
}
```

**Important Notes:**

- **Update the Path**: Replace `/path/to/comfyui-mcp-server-node/dist/server.js` with your actual absolute path:
  - Windows: `"d:\\MyProg\\comfyui-mcp-server\\comfyui-mcp-server-node\\dist\\server.js"`
  - Mac/Linux: `"/path/to/comfyui-mcp-server-node/dist/server.js"`
- **Node.js Command**: You may need to use the full path to your Node.js executable
- **ComfyUI URL**: The `COMFYUI_URL` environment variable should point to your ComfyUI instance (default: `http://localhost:8188`)
- **Build First**: Make sure you've run `npm run build` before using stdio mode

**Steps:**

1. Build the project:

   ```bash
   cd comfyui-mcp-server-node
   npm install
   npm run build
   ```

2. Add the configuration above to Cursor's MCP config file (with your actual path)

3. Restart Cursor (the server will start automatically)

## Locating Cursor's MCP Config

The MCP configuration file location varies by platform. Check Cursor's settings or documentation for the exact location on your system.

## Verifying Connection

After restarting Cursor:

- Cursor should show the ComfyUI MCP server as available
- You should see tools like `generate_image` and `generate_song` available

## Available Tools

Once connected, you'll have access to all MCP tools. See [README.md](../README.md#api-tools) for the complete list, including:

- **list_checkpoint_models**: List available checkpoint models
- **list_unet_models**: List available UNet models (safetensors)
- **list_unet_gguf_models**: List available UNet models (GGUF)
- **generate_image**: Generate images using ComfyUI
- **generate_song**: Generate audio/songs using ComfyUI
- **regenerate**: Regenerate existing assets with parameter overrides
- **view_image**: View generated images inline
- **get_job**, **get_queue_status**, **wait_for_job**, **cancel_job**: Job management
- **list_assets**, **get_asset_metadata**: Asset browsing
- **list_workflows**, **run_workflow**: Workflow execution

## Environment Variables

| Variable                    | Description                 | Default                 |
| --------------------------- | --------------------------- | ----------------------- |
| `COMFYUI_URL`               | ComfyUI instance URL        | `http://localhost:8188` |
| `COMFY_MCP_WORKFLOW_DIR`    | Workflow directory path     | `./workflows`           |
| `COMFY_MCP_ASSET_TTL_HOURS` | Asset time-to-live in hours | `24`                    |

## Troubleshooting

### Server Not Starting

1. **Check Node.js Path**: Make sure `node` in the command is the correct Node.js interpreter
   - Or use the full path: `"C:\\Program Files\\nodejs\\node.exe"` (Windows) or `"/usr/bin/node"` (Mac/Linux)

2. **Check Server Path**: Verify the path to `dist/server.js` is correct and absolute

3. **Check Dependencies**: Ensure all dependencies are installed:

   ```bash
   npm install
   ```

4. **Build the Project**: Make sure you've compiled TypeScript:

   ```bash
   npm run build
   ```

5. **Check ComfyUI**: Make sure ComfyUI is running on the configured port (default: 8188)

### Tools Not Appearing

1. **Check Workflows**: Ensure workflow files exist in the `workflows/` directory
2. **Check Logs**: Look at Cursor's logs or server output for errors
3. **Verify Workflow Format**: Workflows must contain `PARAM_*` placeholders to be auto-discovered

### Build Errors

If you encounter TypeScript compilation errors:

1. **Check Node.js version**: Requires Node.js 18 or higher

   ```bash
   node --version
   ```

2. **Reinstall dependencies**:

   ```bash
   rm -rf node_modules
   npm install
   ```

3. **Clean build**:
   ```bash
   npm run clean
   npm run build
   ```

### General Issues

- **Path Format**: Use forward slashes or escaped backslashes in JSON paths (Windows: `"d:\\\\MyProg\\\\..."` or `"d:/MyProg/..."`)
- **Restart Required**: Always restart Cursor after changing MCP configuration
