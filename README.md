# comfyui-mcp-server-node

_This is improved node.js version of Joe Norton's python project (https://github.com/joenorton/comfyui-mcp-server)._

A lightweight MCP (Model Context Protocol) server that bridges AI agents (like Cursor, Claude, etc.) with a local ComfyUI instance. It enables AI agents to generate and iteratively refine images, audio, and video through conversational tool calls.

**Transport:** Stdio by default (for MCP clients like Cursor, Claude, etc.), with optional HTTP mode via `--http` flag.

## Features

- **Image Generation**: Generate images using Stable Diffusion through ComfyUI
- **Audio Generation**: Generate audio/music using AceStep workflow
- **Workflow System**: PARAM\_\* placeholder system for easy workflow customization
- **Asset Management**: Track, view, and manage generated assets
- **Job Management**: Monitor queue, check job status, cancel jobs
- **Configuration**: List available models

## Quick Start

### Option 1: Via npx (for MCP clients)

No local clone needed. Add to your MCP client configuration (Cursor, Claude, etc.):

```json
"comfyui": {
  "command": "npx",
  "args": ["-y", "comfyui-mcp-server-node"],
  "env": {
    "COMFYUI_URL": "http://localhost:8188",
    "COMFY_MCP_WORKFLOW_DIR": "/path/to/workflows",
    "COMFY_MCP_ASSET_TTL_HOURS": "24"
  }
}
```

> **Note:** ComfyUI must be running at `COMFYUI_URL` before the MCP client connects.

### Option 2: Local development

```bash
git clone https://github.com/yar3333/comfyui-mcp-server-node.git
cd comfyui-mcp-server-node
npm install
npm run build
```

Then start:

| Command              | Mode                               |
| -------------------- | ---------------------------------- |
| `npm start`          | stdio (for MCP clients)            |
| `npm run start:http` | HTTP (`http://127.0.0.1:9000/mcp`) |
| `npm run dev`        | stdio with ts-node                 |
| `npm run dev:http`   | HTTP with ts-node                  |

## Configuration

### Environment Variables

| Variable                    | Description                 | Default                 |
| --------------------------- | --------------------------- | ----------------------- |
| `COMFYUI_URL`               | ComfyUI base URL            | `http://localhost:8188` |
| `COMFY_MCP_WORKFLOW_DIR`    | Path to workflow directory  | `./workflows`           |
| `COMFY_MCP_ASSET_TTL_HOURS` | Asset time-to-live in hours | `24`                    |
| `COMFY_MCP_PORT`            | Server port (HTTP mode)     | `9000`                  |

## API Tools

### Generation Tools

| Tool             | Description                               |
| ---------------- | ----------------------------------------- |
| `generate_image` | Generate an image from a text prompt      |
| `generate_song`  | Generate audio/music from tags and lyrics |
| `regenerate`     | Regenerate a previously generated asset   |

### Viewing Tools

| Tool         | Description                           |
| ------------ | ------------------------------------- |
| `view_image` | View a generated image inline in chat |

### Job Management Tools

| Tool                 | Description                                   |
| -------------------- | --------------------------------------------- |
| `get_queue_status`   | Get current queue status from ComfyUI         |
| `get_job`            | Get job status by prompt_id                   |
| `list_assets`        | List generated assets with optional filtering |
| `get_asset_metadata` | Get full metadata for a specific asset        |
| `cancel_job`         | Cancel a running job by prompt_id             |

### Configuration Tools

| Tool                     | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `list_checkpoint_models` | List available checkpoint models from ComfyUI               |
| `list_unet_models`       | List available UNet models in standard (safetensors) format |
| `list_unet_gguf_models`  | List available UNet models in GGUF format                   |

### Workflow Tools

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `list_workflows` | List available workflows in the workflow directory |
| `run_workflow`   | Run a specific workflow with parameter overrides   |

## Workflow System

Workflows are stored as JSON files in the `workflows/` directory. The system automatically discovers workflows and exposes them as MCP tools. Parameters are defined using the `PARAM_*` placeholder system:

- `PARAM_INT_SEED` - Integer parameter for seed
- `PARAM_FLOAT_CFG` - Float parameter for CFG scale
- `PARAM_STR_SAMPLER_NAME` - String parameter for sampler name
- `PARAM_PROMPT` - String parameter for prompt

## Test

Prerequisites: ComfyUI running at `http://localhost:8188`, server built and started.

```bash
# Run the test client
npx ts-node test_client.ts

# With custom prompt
npx ts-node test_client.ts -p "a beautiful sunset over mountains"
```

```bash
# Run unit tests
npm test
```

## Project Structure

```
comfyui-mcp-server-node/
├── src/
│   ├── comfyui_client.ts        # HTTP client for ComfyUI API
│   ├── asset_processor.ts       # Image processing utilities
│   ├── server.ts                # Main entry point
│   ├── models/                  # Data models
│   │   ├── asset.ts
│   │   └── workflow.ts
│   ├── managers/                # Manager classes
│   │   ├── workflow_manager.ts
│   │   └── asset_registry.ts
│   └── tools/                   # MCP tool implementations
│       ├── helpers.ts
│       ├── generation.ts
│       ├── asset.ts
│       ├── job.ts
│       ├── configuration.ts
│       └── workflow.ts
├── workflows/                   # Workflow JSON files
├── test_client.ts               # Test client
├── package.json
├── tsconfig.json
└── README.md
```

## Changelog

### v2.x.x

- add `list_checkpoint_models` tool
- add `list_unet_models` tool
- add `list_unet_gguf_models` tool
- remove `list_models` tool
- remove publish system (caused confusion for AI agents; use custom output node instead)
- remove default parameters (caused confusion for AI agents; use regular PARAM\_\* instead)
- remove output folder setting (use custom output node instead; for example: https://gist.github.com/kevinjwesley-Collab/a548ee5e6244ebf905f0669e1d7d4958)

## License

MIT

## Author

[@yar3333](https://github.com/yar3333)
