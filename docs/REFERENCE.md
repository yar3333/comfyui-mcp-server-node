# API Reference

Complete technical reference for ComfyUI MCP Server (Node.js/TypeScript) tools, parameters, and behavior.

## Table of Contents

- [Generation Tools](#generation-tools)
- [Viewing Tools](#viewing-tools)
- [Job Management Tools](#job-management-tools)
- [Asset Management Tools](#asset-management-tools)
- [Configuration Tools](#configuration-tools)
- [Workflow Tools](#workflow-tools)
- [Parameters](#parameters)
- [Return Values](#return-values)
- [Error Handling](#error-handling)
- [Limits and Constraints](#limits-and-constraints)

## Generation Tools

### generate_image

Generate images using Stable Diffusion workflows.

**Input Schema (Zod v4):**

```typescript
z.object({
  prompt: z.string(),
  seed: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  model: z.string().optional(),
  steps: z.number().optional(),
  cfg: z.number().optional(),
  sampler_name: z.string().optional(),
  scheduler: z.string().optional(),
  denoise: z.number().optional(),
  negative_prompt: z.string().optional(),
  return_inline_preview: z.boolean().optional(),
});
```

**Required Parameters:**

- `prompt` (string): Text description of the image to generate

**Optional Parameters:**

- `seed` (number): Random seed. Auto-generated if not provided.
- `width` (number): Image width in pixels. Default: 1024
- `height` (number): Image height in pixels. Default: 1024
- `model` (string): Checkpoint model name. Default: first available model
- `steps` (number): Number of sampling steps. Default: 20
- `cfg` (number): Classifier-free guidance scale. Default: 7.0
- `sampler_name` (string): Sampling method. Default: "euler"
- `scheduler` (string): Scheduler type. Default: "normal"
- `denoise` (number): Denoising strength (0.0-1.0). Default: 1.0
- `negative_prompt` (string): Negative prompt. Default: ""
- `return_inline_preview` (boolean): Include thumbnail in response. Default: false

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"asset_id\": \"uuid-string\",\n  \"asset_url\": \"http://localhost:8188/view?filename=...\",\n  \"filename\": \"ComfyUI_00265_.png\",\n  \"width\": 1024,\n  \"height\": 1024,\n  \"mime_type\": \"image/png\",\n  \"bytes_size\": 497648,\n  \"prompt_id\": \"uuid-string\",\n  \"inline_preview_base64\": \"data:image/webp;base64,...\"\n}"
    }
  ]
}
```

**Examples:**

**User:** "Generate an image of a cat"

**Agent:** _Calls `generate_image(prompt="a cat")` → returns asset_id_

---

**User:** "Create a cyberpunk cityscape, 1024x768, high quality, 30 steps, using the SD XL model"

**Agent:** _Calls `generate_image(prompt="cyberpunk cityscape", width=1024, height=768, model="sd_xl_base_1.0.safetensors", steps=30, cfg=7.5, sampler_name="dpmpp_2m", negative_prompt="blurry, low quality")` → returns asset_id_

### generate_song

Generate audio using AceStep workflows.

**Input Schema (Zod v4):**

```typescript
z.object({
  tags: z.string(),
  lyrics: z.string(),
  seed: z.number().optional(),
  steps: z.number().optional(),
  cfg: z.number().optional(),
  seconds: z.number().optional(),
  lyrics_strength: z.number().optional(),
  return_inline_preview: z.boolean().optional(),
});
```

**Required Parameters:**

- `tags` (string): Comma-separated descriptive tags (e.g., "electronic, ambient")
- `lyrics` (string): Full lyric text

**Optional Parameters:**

- `seed` (number): Random seed. Auto-generated if not provided.
- `steps` (number): Number of sampling steps. Default: 20
- `cfg` (number): Classifier-free guidance scale. Default: 7.0
- `seconds` (number): Audio duration in seconds. Default: 30
- `lyrics_strength` (number): Lyrics influence (0.0-1.0). Default: 0.7

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"asset_id\": \"uuid-string\",\n  \"asset_url\": \"http://localhost:8188/view?filename=...\",\n  \"filename\": \"ComfyUI_00001_.mp3\",\n  \"mime_type\": \"audio/mpeg\",\n  \"bytes_size\": 1234567,\n  \"prompt_id\": \"uuid-string\"\n}"
    }
  ]
}
```

## Viewing Tools

### view_image

View generated images inline in chat (thumbnail preview only).

**Input Schema (Zod v4):**

```typescript
z.object({
  asset_id: z.string(),
  mode: z.string().optional(),
  max_dim: z.number().optional(),
  max_b64_chars: z.number().optional(),
});
```

**Parameters:**

- `asset_id` (string): Asset ID returned from generation tools
- `mode` (string): Display mode - `"thumb"` (default) or `"metadata"`
- `max_dim` (number): Maximum dimension in pixels. Default: 1024
- `max_b64_chars` (number): Maximum base64 character count. Default: 100000

**Returns:**

**Mode: "thumb"** (default):

- Returns markdown image with base64 WebP data URI
- WebP format, automatically downscaled and optimized
- Size constrained to fit within `max_b64_chars` limit

**Mode: "metadata"**:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"asset_id\": \"uuid-string\",\n  \"filename\": \"ComfyUI_00265_.png\",\n  \"width\": 1024,\n  \"height\": 1024,\n  \"mime_type\": \"image/png\",\n  \"bytes_size\": 497648\n}"
    }
  ]
}
```

**Supported Types:**

- Images only: PNG, JPEG, WebP, GIF
- Audio/video assets return error: use `asset_url` directly

**Error Responses:**

```json
{
  "content": [{ "type": "text", "text": "Asset not found: uuid-string" }],
  "isError": true
}
```

```json
{
  "content": [{ "type": "text", "text": "Asset is not an image: uuid-string" }],
  "isError": true
}
```

**Examples:**

**User:** "Generate an image of a cat and show it to me"

**Agent:**

- _Calls `generate_image(prompt="a cat")` → gets asset_id_
- _Calls `view_image(asset_id="...")` → displays thumbnail inline_

---

**User:** "What are the dimensions of that last image I generated?"

**Agent:** _Calls `view_image(asset_id="...", mode="metadata")` → returns width, height, size, etc._

## Job Management Tools

### get_queue_status

Check the current state of the ComfyUI job queue.

**Input Schema (Zod v4):**

```typescript
z.object({});
```

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"queue_running\": [],\n  \"queue_pending\": []\n}"
    }
  ]
}
```

**Use Cases:**

- Check if ComfyUI is busy before submitting new jobs
- Monitor queue depth for async awareness
- Determine if a job is still queued vs running

**Examples:**

**User:** "Is ComfyUI busy right now? How many jobs are queued?"

**Agent:** _Calls `get_queue_status()` → reports queue depth and running jobs_

### get_job

Poll the completion status of a specific job by prompt ID.

**Input Schema (Zod v4):**

```typescript
z.object({
  prompt_id: z.string(),
});
```

**Parameters:**

- `prompt_id` (string): Prompt ID returned from generation tools

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"status\": { ... },\n  \"outputs\": { ... }\n}"
    }
  ]
}
```

**Status Values:**

- `"pending"`: Job is queued but not yet running
- `"running"`: Job is currently executing
- `"completed"`: Job finished successfully
- `"error"`: Job failed (check ComfyUI logs)

**Examples:**

**User:** "Generate a complex scene with 50 steps, and let me know when it's done"

**Agent:**

- _Calls `generate_image(prompt="complex scene", steps=50)` → gets prompt_id_
- _Periodically calls `get_job(prompt_id="...")` to check status_
- _When status is "completed", informs user and optionally calls `view_image()`_

---

**User:** "Is that image generation I started earlier finished yet?"

**Agent:** _Calls `get_job(prompt_id="...")` → reports current status (pending/running/completed/error)_

### list_assets

Browse recently generated assets with optional filtering.

**Input Schema (Zod v4):**

```typescript
z.object({
  limit: z.number().optional(),
  workflow_id: z.string().optional(),
  session_id: z.string().optional(),
});
```

**Parameters:**

- `limit` (number, optional): Maximum number of assets to return. Default: 100
- `workflow_id` (string, optional): Filter by workflow ID (e.g., `"generate_image"`)
- `session_id` (string, optional): Filter by session ID for conversation isolation

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\n  {\n    \"asset_id\": \"uuid-string\",\n    \"asset_url\": \"http://localhost:8188/view?filename=...\",\n    \"filename\": \"ComfyUI_00265_.png\",\n    \"width\": 1024,\n    \"height\": 1024,\n    \"mime_type\": \"image/png\",\n    \"bytes_size\": 497648,\n    \"workflow_id\": \"generate_image\",\n    \"created_at\": \"2024-01-01T12:00:00.000Z\"\n  }\n]"
    }
  ]
}
```

**Use Cases:**

- Browse recent generations for AI agent memory
- Filter by workflow to see only images or only audio
- Filter by session for conversation-scoped asset isolation

**Examples:**

**User:** "Show me the last 5 images I generated"

**Agent:** _Calls `list_assets(workflow_id="generate_image", limit=5)` → displays list of recent images_

---

**User:** "What assets have we created in this conversation?"

**Agent:** _Calls `list_assets(session_id="current-session-id")` → lists assets from current session_

### get_asset_metadata

Get complete provenance and parameters for a specific asset.

**Input Schema (Zod v4):**

```typescript
z.object({
  asset_id: z.string(),
});
```

**Parameters:**

- `asset_id` (string): Asset ID returned from generation tools

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"asset_id\": \"uuid-string\",\n  \"asset_url\": \"http://localhost:8188/view?filename=...\",\n  \"filename\": \"ComfyUI_00265_.png\",\n  \"subfolder\": \"\",\n  \"folder_type\": \"output\",\n  \"width\": 1024,\n  \"height\": 1024,\n  \"mime_type\": \"image/png\",\n  \"bytes_size\": 497648,\n  \"workflow_id\": \"generate_image\",\n  \"prompt_id\": \"uuid-string\",\n  \"created_at\": \"2024-01-01T12:00:00.000Z\",\n  \"expires_at\": \"2024-01-02T12:00:00.000Z\",\n  \"comfy_history\": { ... },\n  \"submitted_workflow\": { ... }\n}"
    }
  ]
}
```

**Key Fields:**

- `submitted_workflow`: Exact workflow JSON that was submitted (enables `regenerate`)
- `comfy_history`: Complete ComfyUI execution history
- `created_at` / `expires_at`: Asset lifecycle timestamps

**Use Cases:**

- Inspect exact parameters used for an asset
- Retrieve workflow data for regeneration
- Debug generation issues with full provenance

**Examples:**

**User:** "What parameters were used to generate that last image?"

**Agent:** _Calls `get_asset_metadata(asset_id="...")` → retrieves and reports workflow parameters, dimensions, etc._

---

**User:** "I want to regenerate that image but with different settings - what were the original settings?"

**Agent:** _Calls `get_asset_metadata(asset_id="...")` → shows submitted_workflow data for regeneration_

### cancel_job

Cancel a queued or running job.

**Input Schema (Zod v4):**

```typescript
z.object({
  prompt_id: z.string(),
});
```

**Parameters:**

- `prompt_id` (string): Prompt ID of the job to cancel

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Job uuid-string cancelled successfully"
    }
  ]
}
```

**Error Response:**

```json
{
  "content": [{ "type": "text", "text": "Error: Failed to cancel prompt" }],
  "isError": true
}
```

**Examples:**

**User:** "I started a long image generation task earlier, but I want to cancel it now"

**Agent:**

- _Calls `get_queue_status()` to find running jobs_
- _Calls `cancel_job(prompt_id="...")` to cancel the job_
- _Confirms cancellation to user_

### regenerate

Regenerate an existing asset with optional parameter overrides.

**Input Schema (Zod v4):**

```typescript
z.object({
  asset_id: z.string(),
  seed: z.number().optional(),
  return_inline_preview: z.boolean().optional(),
  param_overrides: z.record(z.string(), z.any()).optional(),
});
```

**Parameters:**

- `asset_id` (string): Asset ID to regenerate
- `seed` (number, optional): New random seed
- `return_inline_preview` (boolean, optional): Include thumbnail in response. Default: false
- `param_overrides` (object, optional): Parameter overrides (e.g., `{"steps": 30, "cfg": 10.0}`)

**Returns:**
Same schema as generation tools (new asset with new `asset_id`)

**Behavior:**

- Uses stored `submitted_workflow` from original asset
- Applies `param_overrides` to modify specific parameters
- All other parameters remain unchanged from original generation
- Returns a new asset (original is not modified)

**Error Response:**

```json
{
  "content": [{ "type": "text", "text": "No workflow found for this asset" }],
  "isError": true
}
```

**Examples:**

**User:** "Generate a sunset image with 20 steps"

**Agent:** _Calls `generate_image(prompt="a sunset", steps=20)` → gets asset_id_

**User:** "Now regenerate that same image but with higher quality - 30 steps and cfg 10"

**Agent:** _Calls `regenerate(asset_id="...", param_overrides={"steps": 30, "cfg": 10.0})` → creates new version_

---

**User:** "Regenerate that image but change the prompt to 'a beautiful sunset, oil painting style'"

**Agent:** _Calls `regenerate(asset_id="...", param_overrides={"prompt": "a beautiful sunset, oil painting style"})` → creates variation_

---

**User:** "Generate a new variation of that image with a different random seed"

**Agent:** _Calls `regenerate(asset_id="...", seed=-1)` → creates new variation with different seed_

## Configuration Tools

### list_models

List all available checkpoint models in ComfyUI.

**Input Schema (Zod v4):**

```typescript
z.object({});
```

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\n  \"v1-5-pruned-emaonly.safetensors\",\n  \"sd_xl_base_1.0.safetensors\",\n  ...\n]"
    }
  ]
}
```

**Examples:**

**User:** "What models are available in ComfyUI?"

**Agent:** _Calls `list_models()` → reports available checkpoint models_

---

**User:** "I want to use a different model - show me what's available"

**Agent:** _Calls `list_models()` → lists models, user selects one, agent uses it in generation_

## Workflow Tools

### list_workflows

List all available workflows in the workflow directory.

**Input Schema (Zod v4):**

```typescript
z.object({});
```

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "[\n  {\n    \"workflow_id\": \"generate_image\",\n    \"tool_name\": \"generate_image\",\n    \"description\": \"Generate content using generate_image workflow\",\n    \"parameters\": [\n      {\n        \"name\": \"prompt\",\n        \"type\": \"string\",\n        \"required\": true\n      }\n    ]\n  }\n]"
    }
  ]
}
```

**Examples:**

**User:** "What workflows are available?"

**Agent:** _Calls `list_workflows()` → lists all available workflows with descriptions and parameters_

---

**User:** "Show me what custom workflows I can run"

**Agent:** _Calls `list_workflows()` → displays workflow catalog with available inputs_

### run_workflow

Run any saved ComfyUI workflow with constrained parameter overrides.

**Input Schema (Zod v4):**

```typescript
z.object({
  workflow_id: z.string(),
  overrides: z.record(z.string(), z.any()).optional(),
  options: z.record(z.string(), z.any()).optional(),
  return_inline_preview: z.boolean().optional(),
});
```

**Parameters:**

- `workflow_id` (string): Workflow ID (filename stem, e.g., "generate_image")
- `overrides` (object): Parameter overrides
- `options` (object): Reserved for future use
- `return_inline_preview` (boolean): Include thumbnail. Default: false

**Returns:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"asset_id\": \"uuid-string\",\n  \"asset_url\": \"http://localhost:8188/view?filename=...\",\n  \"filename\": \"ComfyUI_00265_.png\",\n  \"width\": 1024,\n  \"height\": 1024,\n  \"mime_type\": \"image/png\",\n  \"bytes_size\": 497648,\n  \"prompt_id\": \"uuid-string\"\n}"
    }
  ]
}
```

**Error Response:**

```json
{
  "content": [{ "type": "text", "text": "Workflow not found: invalid_workflow" }],
  "isError": true
}
```

**Examples:**

**User:** "Run the generate_image workflow with a custom prompt and 30 steps"

**Agent:** _Calls `run_workflow(workflow_id="generate_image", overrides={"prompt": "...", "steps": 30})` → executes workflow_

---

**User:** "Use the generate_image workflow to create a 1024x1024 image of a cat with the SD XL model"

**Agent:** _Calls `run_workflow(workflow_id="generate_image", overrides={"prompt": "a cat", "width": 1024, "height": 1024, "model": "sd_xl_base_1.0.safetensors"})` → executes workflow_

## Parameters

### Common Parameter Types

| Type     | Zod Schema                      | Description      |
| -------- | ------------------------------- | ---------------- |
| string   | `z.string()`                    | Text value       |
| number   | `z.number()`                    | Integer or float |
| boolean  | `z.boolean()`                   | true/false       |
| object   | `z.record(z.string(), z.any())` | Key-value pairs  |
| optional | `.optional()`                   | Can be omitted   |

### Workflow Parameters

Workflow parameters are extracted from `PARAM_*` placeholders:

| Placeholder                   | Type   | Required                |
| ----------------------------- | ------ | ----------------------- |
| `PARAM_PROMPT`                | string | Yes                     |
| `PARAM_INT_SEED`              | number | No                      |
| `PARAM_INT_STEPS`             | number | No                      |
| `PARAM_FLOAT_CFG`             | number | No                      |
| `PARAM_STR_SAMPLER_NAME`      | string | No                      |
| `PARAM_STR_SCHEDULER`         | string | No                      |
| `PARAM_FLOAT_DENOISE`         | number | No                      |
| `PARAM_MODEL`                 | string | No                      |
| `PARAM_INT_WIDTH`             | number | No                      |
| `PARAM_INT_HEIGHT`            | number | No                      |
| `PARAM_NEGATIVE_PROMPT`       | string | No                      |
| `PARAM_TAGS`                  | string | Yes (for generate_song) |
| `PARAM_LYRICS`                | string | Yes (for generate_song) |
| `PARAM_FLOAT_LYRICS_STRENGTH` | number | No                      |
| `PARAM_INT_SECONDS`           | number | No                      |

## Return Values

All tools return responses in the following format:

**Success Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Response data (usually JSON string)"
    }
  ]
}
```

**Error Response:**

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error message"
    }
  ],
  "isError": true
}
```

## Error Handling

### Common Error Messages

| Error                             | Cause                           | Solution                                     |
| --------------------------------- | ------------------------------- | -------------------------------------------- |
| `Asset not found: ...`            | Asset expired or invalid        | Regenerate the asset or use a valid asset_id |
| `Workflow not found: ...`         | Workflow file doesn't exist     | Check workflow directory and filename        |
| `Failed to queue workflow: ...`   | ComfyUI unavailable or error    | Ensure ComfyUI is running and accessible     |
| `Workflow execution failed: ...`  | ComfyUI workflow error          | Check ComfyUI logs for details               |
| `Target file already exists: ...` | File exists and overwrite=false | Use `overwrite=true` or different filename   |

### ComfyUI Connection Errors

If ComfyUI is not available, the server will:

1. Retry connection with exponential backoff (2s → 4s → 8s → 16s)
2. Exit after 5 failed attempts
3. Require manual restart after ComfyUI is started

## Limits and Constraints

### Asset Limits

| Limit                   | Value    | Description             |
| ----------------------- | -------- | ----------------------- |
| Asset TTL               | 24 hours | Default expiration time |
| Inline preview size     | ~100KB   | Base64 character budget |
| Thumbnail max dimension | 1024px   | Default max dimension   |

### Workflow Limits

| Limit           | Value      | Description                   |
| --------------- | ---------- | ----------------------------- |
| Poll attempts   | 30         | Maximum wait time ~30 seconds |
| Poll interval   | 1 second   | Between each attempt          |
| Request timeout | 30 seconds | For ComfyUI API calls         |

### Image Processing Limits

| Limit            | Value        | Description              |
| ---------------- | ------------ | ------------------------ |
| Quality ladder   | 70 → 55 → 40 | WebP quality levels      |
| Max base64 chars | 100,000      | Default character budget |
| Max dimension    | 1024px       | Default resize limit     |
