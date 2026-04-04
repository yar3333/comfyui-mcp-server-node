# Architecture

High-level architecture and design decisions for ComfyUI MCP Server (Node.js/TypeScript).

## Overview

The server bridges MCP (Model Context Protocol) and ComfyUI, providing a standardized interface for AI agents to generate media through ComfyUI workflows. This is a Node.js/TypeScript implementation using the `@modelcontextprotocol/sdk` package.

## Design Decisions

These foundational decisions shape the entire architecture and should be understood before diving into implementation details.

### Why Streamable-HTTP?

- Better scalability than WebSocket
- Cloud-ready (works behind load balancers)
- Standard HTTP tooling
- Stateless (easier to scale horizontally)

### Why Stable Asset Identity?

**Problem:** URL-based identity breaks with hostname/port changes.

**Solution:** Use `(filename, subfolder, type)` tuple as stable identity:
- Works across different ComfyUI instances (localhost, 127.0.0.1, different ports)
- Resilient to ComfyUI restarts for already-known output identities (URL computation)
- URLs computed on-the-fly from base_url
- O(1) lookups via dual-index structure

**Benefits:**
- Robust to configuration changes
- No "thor:8188" hostname bugs
- Portable across deployments

### Why UUID Asset IDs?

- Globally unique external reference
- Opaque (doesn't leak internal structure)
- Standard format
- Separate from stable identity (internal lookup)

### Why Full Provenance Storage?

**Stored Data:**
- `comfy_history`: Full `/history/{prompt_id}` response snapshot
- `submitted_workflow`: Original workflow JSON submitted to ComfyUI

**Benefits:**
- Free reproducibility (can regenerate with exact parameters)
- Debugging becomes trivial (see exactly what was submitted)
- Enables `regenerate()` tool without re-specifying everything
- Complete audit trail

**Trade-offs:**
- History snapshots can be large for complex workflows
- TTL-based expiration (24h) limits growth
- Future: Consider compression or selective field storage

### Why TTL Instead of Manual Deletion?

- Automatic cleanup reduces memory usage
- No manual management needed
- Predictable behavior
- Configurable per deployment

### Why Separate view_image Tool?

- Lazy loading: Only fetch/process when needed
- Size control: Enforce limits at viewing time
- Format conversion: Optimize for display
- Separation of concerns: Generation vs. viewing

### Why Thin Adapter Architecture?

The server delegates execution to ComfyUI rather than reimplementing:
- **Queue logic**: Direct passthrough to `/prompt` endpoint
- **History tracking**: Direct passthrough to `/history` endpoint
- **Job cancellation**: Direct passthrough to `/queue` with delete action

**Benefits:**
- No sync issues (ComfyUI is source of truth)
- Minimal code surface
- Leverages ComfyUI's native capabilities
- Easier to maintain (changes in ComfyUI automatically reflected)

## Core Components

### WorkflowManager

**Purpose**: Discovers, loads, and processes ComfyUI workflow JSON files.

**Responsibilities:**
- Scan `workflows/` directory for JSON files
- Extract parameters from `PARAM_*` placeholders
- Build `WorkflowToolDefinition` objects
- Render workflows with provided parameters
- Apply constrained overrides (for `run_workflow`)

**Key Methods:**
- `discoverWorkflows()`: Scan and load workflow files
- `extractParameters()`: Placeholder parsing
- `renderWorkflow()`: Parameter substitution
- `applyWorkflowOverrides()`: Constrained parameter updates

### DefaultsManager

**Purpose**: Manages default values with configurable precedence.

**Precedence Order:**
1. Per-call values (explicit parameters)
2. Runtime defaults (`set_defaults` tool)
3. Config file (`~/.config/comfy-mcp/config.json`)
4. Environment variables
5. Hardcoded defaults

**Key Methods:**
- `get()`: Resolve value with precedence
- `setNamespaceDefaults()`: Set runtime defaults
- `persistConfig()`: Write to config file

### AssetRegistry

**Purpose**: Track generated assets for viewing and management.

**Features:**
- UUID-based asset IDs for external reference
- Stable identity using `(filename, subfolder, type)` tuple (robust to URL changes)
- TTL-based expiration (default 24 hours)
- O(1) lookups via dual-index structure (`assets` and `byFilename` maps)
- Full provenance storage (`comfy_history`, `submitted_workflow`)
- Session tracking for conversation isolation
- Automatic cleanup of expired assets

**Key Methods:**
- `registerAsset()`: Register new asset with stable identity, return `AssetRecord`
- `getAsset()`: Retrieve by ID (checks expiration)
- `listAssets()`: List assets with optional filtering (workflow_id, session_id)
- `deleteExpiredAssets()`: Remove expired assets

**Stable Identity Design:**
Assets are identified by `(filename, subfolder, folder_type)` instead of URLs, making the system robust to:
- Hostname/port/base-url changes
- Resilient to ComfyUI restarts for already-known output identities

URLs are computed on-the-fly from the stable identity when needed.

**Note:** Stable identity prevents URL/base changes from breaking computed URLs, but does not imply persistence of the asset registry across MCP server restarts.

### ComfyUIClient

**Purpose**: Interface with ComfyUI API as a thin adapter.

**Responsibilities:**
- Queue workflows via `/prompt` endpoint
- Poll for completion via `/history/{prompt_id}`
- Extract asset info (filename, subfolder, type) from outputs (stable identity)
- Fetch asset metadata (size, dimensions, mime type)
- Direct passthrough to ComfyUI queue and history endpoints
- Cancel queued/running jobs

**Key Methods:**
- `runCustomWorkflow()`: Execute workflow and wait for completion, returns stable identity + provenance
- `_queueWorkflow()`: Submit workflow to ComfyUI
- `_waitForPrompt()`: Poll until completion
- `_extractFirstAssetInfo()`: Extract `(filename, subfolder, type)` from outputs
- `getQueue()`: Direct passthrough to `/queue` endpoint
- `getHistory(promptId)`: Direct passthrough to `/history` endpoint
- `cancelPrompt(promptId)`: Cancel queued or running jobs

**Thin Adapter Philosophy:**
The client delegates execution to ComfyUI rather than reimplementing queue logic. ComfyUI is the source of truth for job state.

## Workflow System

### Discovery

1. `WorkflowManager` scans `workflows/` directory
2. Loads JSON files
3. Extracts `PARAM_*` placeholders
4. Builds parameter definitions with types and bindings
5. Creates `WorkflowToolDefinition` objects

### Parameter Extraction

**Placeholder Format**: `PARAM_<TYPE?>_<NAME>`

**Examples:**
- `PARAM_PROMPT` → `prompt: string` (required)
- `PARAM_INT_STEPS` → `steps: number` (optional)
- `PARAM_FLOAT_CFG` → `cfg: number` (optional)

**Binding**: Maps to `nodeId.inputKey` in workflow JSON

### Tool Registration

1. `registerWorkflowGenerationTools()` iterates over definitions
2. Creates dynamic tools with Zod v4 schemas for validation
3. Handles type coercion (JSON-RPC strings → TypeScript types)
4. Registers with McpServer via `server.registerTool()`

### Execution Flow

1. Tool called with parameters
2. `renderWorkflow()` substitutes placeholders with values
3. Defaults applied for missing optional parameters
4. Workflow queued to ComfyUI via `/prompt` endpoint
5. Server polls for completion via `/history/{prompt_id}`
6. Asset info extracted from outputs: `(filename, subfolder, type)` (stable identity)
7. Full history snapshot fetched from ComfyUI
8. Asset registered in `AssetRegistry` with:
   - Stable identity (filename, subfolder, folder_type)
   - Provenance data (`comfy_history`, `submitted_workflow`)
   - Session ID (if provided)
9. Asset URL computed from stable identity
10. Response returned with `asset_id`, `asset_url`, and metadata

## Asset Lifecycle

### Generation

1. Workflow executes in ComfyUI
2. Asset saved to ComfyUI output directory
3. ComfyUI returns output metadata

### Registration

1. `AssetRegistry.registerAsset()` called with `(filename, subfolder, type)` stable identity
2. UUID generated for `asset_id` (external reference)
3. Stable identity key created: `folderType/subfolder/filename`
4. Expiration time calculated (now + TTL)
5. `AssetRecord` created with:
   - Stable identity fields (filename, subfolder, folder_type)
   - Provenance data (`comfy_history`, `submitted_workflow`)
   - Session ID (for conversation isolation)
6. Dual-index storage:
   - `assets.set(assetId, record)` (UUID lookup)
   - `byFilename.set(stableKey, Set<assetId>)` (identity lookup)

### Viewing

1. `view_image` called with `asset_id`
2. `AssetRegistry.getAsset()` retrieves record by UUID
3. Expiration checked (returns null if expired)
4. Asset URL computed from stable identity
5. Asset bytes fetched from ComfyUI `/view` endpoint (URL-encoded for special characters)
6. Image processed (downscale, re-encode as WebP)
7. Base64-encoded thumbnail returned

**URL Computation:**
URLs are computed on-the-fly from stable identity, ensuring they work even if ComfyUI base URL changes:
```typescript
const encodedFilename = encodeURIComponent(filename);
const encodedSubfolder = subfolder ? encodeURIComponent(subfolder) : '';
const assetUrl = `${baseUrl}/view?filename=${encodedFilename}&subfolder=${encodedSubfolder}&type=${folderType}`;
```

### Expiration

1. Assets expire after TTL (default 24 hours)
2. `deleteExpiredAssets()` removes expired records
3. Called periodically or on access

## Image Processing Pipeline

### Purpose

Convert large images to small, context-friendly thumbnails for inline display in chat (i.e. for image injection into AI context).

### Constraints

- **Size limit**: ~100KB base64 payload (configurable)
- **Dimension limit**: 1024px max dimension (configurable)
- **Format**: WebP (efficient compression)

### Process

1. **Fetch**: Download image bytes from ComfyUI
2. **Load**: Open with sharp, get metadata
3. **Downscale**: Resize to fit within `maxDim` (maintain aspect ratio)
4. **Optimize**: Quality ladder (70 → 55 → 40) to fit budget
5. **Encode**: Save as WebP, base64 encode
6. **Validate**: Check total payload size (base64 + data URI prefix)

### Why WebP?

- Better compression than PNG/JPEG
- Supports transparency
- Widely supported in modern clients
- Good quality/size tradeoff

### Why Thumbnails Only?

- Context window limits in AI chat interfaces
- Base64 encoding adds ~33% overhead
- Large images cause context bloat and crashes
- Thumbnails provide visual feedback without cost

## Default Value System

### Why Multiple Sources?

Different use cases need different defaults:
- **Hardcoded**: Sensible defaults for new users
- **Config file**: Persistent preferences
- **Runtime**: Session-specific overrides
- **Environment**: Deployment-specific settings

### Resolution Algorithm

```typescript
function get(parameterName, namespace) {
  // Check runtime defaults
  if (parameterName in runtimeDefaults) return runtimeDefaults[parameterName];
  
  // Check config defaults
  if (parameterName in configDefaults) return configDefaults[parameterName];
  
  // Check env vars
  const envValue = process.env[`COMFY_MCP_${parameterName.toUpperCase()}`];
  if (envValue !== undefined) return parseEnvValue(envValue);
  
  // Check hardcoded defaults
  if (namespace && hardcodedDefaults[namespace]) {
    return hardcodedDefaults[namespace][parameterName];
  }
  
  return hardcodedDefaults[parameterName];
}
```

## Security Considerations

### Path Traversal Protection

Workflow IDs are sanitized before file access:

```typescript
const safeId = workflowId.replace(/[\/\\..]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
```

Resolved paths are validated to be within `workflows/` directory.

### URL Encoding

Special characters in filenames are properly URL-encoded when constructing asset URLs:

```typescript
const encodedFilename = encodeURIComponent(filename);
const encodedSubfolder = subfolder ? encodeURIComponent(subfolder) : '';
```

Prevents injection attacks and ensures valid URLs for all filenames.

### Asset Access Control

- Only assets generated by this server can be viewed
- `asset_id` must exist in registry (UUID lookup)
- Expired assets are automatically removed
- No direct file system access from tools
- Asset URLs computed from stable identity (validated)

### Parameter Validation

- Zod v4 schemas validate all tool inputs
- Type coercion with validation
- Constraints enforced (min/max/enum) if metadata provided
- Workflow metadata provides additional validation

## Performance Considerations

### Caching

- **Workflows**: Cached after first load (mtime-based invalidation)
- **Model list**: Cached in `ComfyUIClient` (refreshed on init)

### Polling Strategy

- 1-second intervals
- Maximum 30 attempts (30 seconds)
- Exponential backoff considered but not implemented

### Memory Management

- Asset registry: In-memory Map with dual-index structure
  - `assets`: UUID → AssetRecord (O(1) lookup)
  - `byFilename`: Stable identity → Set<UUID> (O(1) lookup)
- Expired assets cleaned up automatically
- Provenance data: Stored as-is (no compression), TTL limits growth

### Lookup Performance

- Asset by ID: O(1) via `assets` Map
- Asset by identity: O(1) via `byFilename` Map
- List assets: O(n log n) for sorting (n = total assets, typically small)
- URL encoding: Applied only when computing URLs (not stored)

### History Snapshot Size

`comfy_history` can be large for complex workflows:
- Stored as-is (no compression in v1)
- TTL-based expiration (24h) limits growth
- Future: Consider compression or selective field storage

## Job Management

The server provides tools for monitoring and controlling ComfyUI job execution, enabling AI agents to work asynchronously.

### Queue Status

`get_queue_status()` provides async awareness:
- Check if ComfyUI is busy before submitting new jobs
- Monitor queue depth
- Determine if a job is queued vs running

**Implementation:**
Direct passthrough to ComfyUI `/queue` endpoint - no reimplementation of queue logic.

### Job Polling

`get_job(prompt_id)` polls job completion:
- Checks queue first (running/queued status)
- Falls back to history endpoint for completed jobs
- Returns structured status: `completed`, `running`, `queued`, `error`, `not_found`
- Includes full history snapshot when available

**Error Handling:**
- Gracefully handles missing prompt_ids
- Distinguishes between "not found" and "error" states
- Handles ComfyUI unavailability

### Asset Browsing

`list_assets()` enables AI memory and iteration:
- Lists recently generated assets
- Filterable by `workflow_id` (e.g., only images)
- Filterable by `session_id` (conversation isolation)
- Returns stable identity for reliable follow-ups

### Asset Metadata

`get_asset_metadata(asset_id)` provides full provenance:
- Complete asset details (dimensions, size, type)
- Full ComfyUI history snapshot
- Original submitted workflow (enables regeneration)
- Creation and expiration timestamps

### Regeneration

`regenerate(asset_id, param_overrides)` enables iteration:
- Retrieves original workflow from `submitted_workflow`
- Applies parameter overrides (e.g., `{"steps": 30, "cfg": 10.0}`)
- Re-submits to ComfyUI with modifications
- Preserves session ID for conversation continuity

**Implementation:**
Uses deep copy of stored workflow, applies overrides via `updateWorkflowParams()`, handles seed separately.

### Cancellation

`cancel_job(prompt_id)` cancels queued or running jobs:
- Direct passthrough to ComfyUI `/queue` with delete action
- Provides user control and resource management

## Publish System

The publish system enables AI agents to safely copy ComfyUI-generated assets into web project directories with deterministic filenames, optional WebP compression, and manifest management.

### Purpose

Bridge the gap between ComfyUI's output directory and web project asset directories:
- Copy generated assets to project's web directory (e.g., `public/gen/`)
- Enforce provenance (only assets from current session)
- Preserve original format by default (typically PNG from ComfyUI)
- Optional WebP compression when `web_optimize=true` (deterministic compression ladder)
- Support two modes: explicit filenames (demo) and manifest-based (library)
- Auto-detect configuration with conservative fallbacks

### Core Components

#### PublishConfig

**Purpose**: Manages publish configuration with auto-detection and persistent storage.

**Responsibilities:**
- Auto-detect project root (primary: `cwd`, fallback: search for markers)
- Auto-detect publish root (`public/gen`, `static/gen`, or `assets/gen`)
- Auto-detect ComfyUI output root (tight candidate list, validated)
- Load/save persistent configuration (platform-specific)
- Track detection methods and tried paths for debugging

**Key Methods:**
- `detectProjectRoot()`: Find project root with conservative fallback
- `detectPublishRoot()`: Infer publish directory from project structure
- `detectComfyuiOutputRoot()`: Best-effort detection with validation

**Configuration Priority:**
1. Explicit parameters (constructor args)
2. Persistent config file (platform-specific)
3. Auto-detection (best-effort)

#### PublishManager

**Purpose**: Manages safe asset publishing with path validation, compression, and manifest updates.

**Responsibilities:**
- Validate source paths (must be within ComfyUI output root)
- Validate target paths (must be within publish root)
- Compress images using deterministic ladder
- Update manifest.json atomically
- Provide status reporting via `get_publish_info()`

**Key Methods:**
- `validateSourcePath()`: Validate source is within ComfyUI output root
- `validateTargetPath()`: Validate target is within publish root
- `optimizeForWeb()`: Deterministic compression ladder
- `publishAsset()`: Copy with optional compression and atomic write
- `updateManifest()`: Atomic manifest update

### Publishing Flow

1. **Configuration Check**: Validate publish root and ComfyUI output root
2. **Asset Lookup**: Retrieve asset from `AssetRegistry` by `asset_id` (session-scoped)
3. **Source Resolution**: Validate source is within ComfyUI output root
4. **Target Resolution**: Validate target filename and resolve path
5. **Compression** (if `web_optimize=true`): Deterministic compression ladder to meet `max_bytes` limit, otherwise copy as-is
6. **Atomic Copy**: Write to temporary file, then atomic rename
7. **Manifest Update** (if `manifest_key` provided): Atomic read/modify/write

### Two Publishing Modes

**Demo Mode** (explicit filename):
- Agent provides `target_filename` (e.g., `"hero.webp"`)
- Deterministic output location: `<publish_root>/<target_filename>`
- Manifest not updated unless `manifest_key` also provided
- Use case: Direct file references, simple deployments

**Library Mode** (auto-generated with manifest):
- Agent provides `manifest_key`, omits `target_filename`
- Filename auto-generated: `asset_<shortid>.webp`
- Manifest automatically updated: `{"manifest_key": "filename"}`
- Use case: Hot-swappable assets, dynamic loading via manifest

### Key Design Decisions

#### Path Safety and Canonicalization

**Problem**: Path traversal attacks, symlink issues, relative path confusion.

**Solution**: All paths are canonicalized before use:
```typescript
const resolved = path.resolve(sourcePath);
const comfyuiRoot = path.resolve(this.config.comfyuiOutputRoot);
if (!resolved.startsWith(comfyuiRoot)) {
  throw new Error(`Source path must be within ComfyUI output root`);
}
```

**Containment Checks**: Validates paths are within parent directories using `startsWith()` after resolution.

**Benefits:**
- Prevents `../../../etc/passwd` style attacks
- Handles symlinks correctly (resolves to real path)
- Works for both existing and non-existent paths
- Clear error messages when containment fails

#### Provenance Enforcement

**Problem**: Prevent arbitrary filesystem copying, ensure assets come from ComfyUI.

**Solution**: Multi-layer validation:
1. **Session-scoped `asset_id`**: Only assets registered in current session can be published
2. **Source Validation**: Source paths must be within configured ComfyUI output root
3. **Asset Registry Integration**: Uses existing `AssetRegistry` to verify asset identity

**Benefits:**
- Prevents copying arbitrary files
- Ensures assets come from ComfyUI runs
- Session isolation prevents cross-contamination
- Clear error messages when provenance fails

#### Optional WebP Compression

**Problem**: Need optional compression for web optimization while preserving original quality by default.

**Solution**: Compression is opt-in via `web_optimize` parameter:
- **Default (`web_optimize=false`)**: Assets copied as-is, preserving original format (typically PNG)
- **Web optimization (`web_optimize=true`)**: Convert to WebP and apply deterministic compression ladder

**Deterministic Compression Ladder** (when `web_optimize=true`):
1. **Quality progression**: [85, 70, 55, 40, 35]
2. **Downscale factors**: [1.0, 0.75, 0.5] (if needed)
3. **Format conversion**: PNG/JPEG → WebP

**Algorithm:**
```typescript
for (const quality of [85, 70, 55, 40, 35]) {
  for (const scale of [1.0, 0.75, 0.5]) {
    let processed = sharp(imageBuffer);
    if (scale < 1.0) {
      processed = processed.resize({ width: Math.floor(width * scale) });
    }
    const optimized = await processed.webp({ quality }).toBuffer();
    if (!maxBytes || optimized.length <= maxBytes) {
      return optimized;
    }
  }
}
```

**Benefits:**
- Deterministic behavior (same input → same output)
- Meets size constraints predictably
- Preserves quality when possible
- Graceful degradation under tight limits

#### Atomic File Writes

**Problem**: Partial writes corrupt files, especially problematic for manifest.json.

**Solution**: Write to temporary file, then atomic rename:
```typescript
const tempPath = targetPath + '.tmp';
fs.writeFileSync(tempPath, data);
fs.renameSync(tempPath, targetPath);
```

**Benefits:**
- No partial/corrupt files
- Crash-safe (rename is atomic on most filesystems)
- Simple implementation

## Node.js/TypeScript Specific Considerations

### SDK Version

Uses `@modelcontextprotocol/sdk` v1+ with the modern `registerTool()` API and Zod v4 schemas for input validation.

### Image Processing

Uses `sharp` instead of Pillow for image processing:
- Native library (libvips) for high performance
- Supports WebP, PNG, JPEG, GIF
- Streaming API for memory efficiency
- Better compression than pure JavaScript alternatives

### HTTP Client

Uses `axios` instead of `requests`:
- Promise-based API
- Automatic JSON transformation
- Request/response interceptors
- Better TypeScript support

### Type Safety

Full TypeScript type safety:
- Zod v4 schemas for runtime validation
- Type inference from schemas
- Compile-time type checking
- No `any` types in public APIs

### Async/Await Pattern

All I/O operations use async/await:
- Non-blocking operations
- Proper error handling with try/catch
- Promise-based API throughout
- No callback hell
