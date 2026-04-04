# ComfyUI MCP Server (Node.js/TypeScript)

_This is a node.js version of Joe Norton's python project (https://github.com/joenorton/comfyui-mcp-server)._

A lightweight MCP (Model Context Protocol) server that bridges AI agents (like Cursor, Claude, etc.) with a local ComfyUI instance. It enables AI agents to generate and iteratively refine images, audio, and video through conversational tool calls.

**Transport:** Streamable HTTP on `http://127.0.0.1:9000/mcp` (with optional stdio mode for MCP clients).

## Features

- **Image Generation**: Generate images using Stable Diffusion through ComfyUI
- **Audio Generation**: Generate audio/music using AceStep workflow
- **Workflow System**: PARAM\_\* placeholder system for easy workflow customization
- **Asset Management**: Track, view, and manage generated assets
- **Job Management**: Monitor queue, check job status, cancel jobs
- **Publish System**: Publish assets to web project directories with optimization
- **Configuration**: Manage defaults and model settings

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

- `COMFYUI_URL` - ComfyUI base URL (default: `http://localhost:8188`)
- `COMFY_MCP_WORKFLOW_DIR` - Path to workflow directory
- `COMFY_MCP_ASSET_TTL_HOURS` - Asset time-to-live in hours (default: 24)
- `COMFYUI_OUTPUT_ROOT` - ComfyUI output directory path
- `COMFY_MCP_PORT` - Server port (default: 9000)

## Usage

### Start the server (HTTP mode)

```bash
npm run build
npm start
```

### Start the server (stdio mode for MCP clients)

```bash
npm run start:stdio
```

### Development mode

```bash
npm run dev          # HTTP mode
npm run dev:stdio    # stdio mode
```

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

| Tool           | Description                                   |
| -------------- | --------------------------------------------- |
| `list_models`  | List available checkpoint models from ComfyUI |
| `get_defaults` | Get current default values                    |
| `set_defaults` | Set default values for generation parameters  |

### Workflow Tools

| Tool             | Description                                        |
| ---------------- | -------------------------------------------------- |
| `list_workflows` | List available workflows in the workflow directory |
| `run_workflow`   | Run a specific workflow with parameter overrides   |

### Publish Tools

| Tool                      | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `get_publish_info`        | Get information about the publish system configuration |
| `set_comfyui_output_root` | Set the ComfyUI output directory path                  |
| `publish_asset`           | Publish a generated asset to a web project directory   |

## Workflow System

Workflows are stored as JSON files in the `workflows/` directory. The system automatically discovers workflows and exposes them as MCP tools. Parameters are defined using the `PARAM_*` placeholder system:

- `PARAM_INT_SEED` - Integer parameter for seed
- `PARAM_FLOAT_CFG` - Float parameter for CFG scale
- `PARAM_STR_SAMPLER_NAME` - String parameter for sampler name
- `PARAM_PROMPT` - String parameter for prompt

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
│   │   ├── defaults_manager.ts
│   │   ├── asset_registry.ts
│   │   └── publish_manager.ts
│   └── tools/                   # MCP tool implementations
│       ├── helpers.ts
│       ├── generation.ts
│       ├── asset.ts
│       ├── job.ts
│       ├── configuration.ts
│       ├── workflow.ts
│       └── publish.ts
├── workflows/                   # Workflow JSON files
├── test_client.ts               # Test client
├── package.json
├── tsconfig.json
└── README.md
```

## Changes related to node.js implementation (in comparing to original python implementation)

- base mcp library: mcp (Python) => @modelcontextprotocol/sdk
- data validation: Python typing => Zod v4 schemes
- image processing: Pillow => sharp
- http: requests => axios
- entry point: server.py => dist/server.js

## License

MIT

## Author

[@yar3333](https://github.com/yar3333)
