import * as fs from "fs";
import * as path from "path";
import { WorkflowToolDefinition, WorkflowParameter } from "../models/workflow";

interface WorkflowFileInfo {
  path: string;
  mtime: number;
}

interface WorkflowCatalogEntry {
  id: string;
  name: string;
  description: string;
  available_inputs: Record<string, { type: string; required: boolean; description: string }>;
  defaults: Record<string, any>;
  updated_at?: string;
  hash?: string;
}

const PLACEHOLDER_PREFIX = "PARAM_";
const PLACEHOLDER_TYPE_HINTS: Record<string, string> = {
  STR: "string",
  STRING: "string",
  TEXT: "string",
  INT: "integer",
  FLOAT: "number",
  BOOL: "boolean",
};

const PLACEHOLDER_DESCRIPTIONS: Record<string, string> = {
  prompt: "Main text prompt used inside the workflow.",
  seed: "Random seed for image generation. If not provided, a random seed will be generated.",
  width: "Image width in pixels. Default: 512.",
  height: "Image height in pixels. Default: 512.",
  model: "Checkpoint model name (e.g., 'v1-5-pruned-emaonly.safetensors', 'sd_xl_base_1.0.safetensors').",
  steps: "Number of sampling steps. Higher = better quality but slower. Default: 20.",
  cfg: "Classifier-free guidance scale. Higher = more adherence to prompt. Default: 8.0.",
  sampler_name: "Sampling method (e.g., 'euler', 'dpmpp_2m', 'ddim'). Default: 'euler'.",
  scheduler: "Scheduler type (e.g., 'normal', 'karras', 'exponential'). Default: 'normal'.",
  denoise: "Denoising strength (0.0-1.0). Default: 1.0.",
  negative_prompt: "Negative prompt to avoid certain elements. Default: 'text, watermark'.",
  tags: "Comma-separated descriptive tags for the audio model.",
  lyrics: "Full lyric text that should drive the audio generation.",
  seconds: "Audio duration in seconds. Default: 60 (1 minute).",
  lyrics_strength: "How strongly lyrics influence audio generation (0.0-1.0). Default: 0.99.",
  duration: "Video duration in seconds. Default: 5.",
  fps: "Frames per second for video output. Default: 16.",
};

const OPTIONAL_PARAMS = new Set([
  "seed",
  "width",
  "height",
  "model",
  "steps",
  "cfg",
  "sampler_name",
  "scheduler",
  "denoise",
  "negative_prompt",
  "seconds",
  "lyrics_strength",
  "duration",
  "fps",
]);

export class WorkflowManager {
  private workflowDir: string;
  private workflows: Map<string, WorkflowFileInfo> = new Map();
  private workflowCache: Map<string, WorkflowToolDefinition> = new Map();
  private toolNames: Set<string> = new Set();
  private workflowMtime: Map<string, number> = new Map();

  constructor(workflowDir: string) {
    this.workflowDir = workflowDir;
    this._discoverWorkflows();
  }

  /**
   * Resolve workflow ID to file path with path traversal protection.
   */
  private _safeWorkflowPath(workflowId: string): string | null {
    // Sanitize workflow ID
    let safeId = workflowId.replace(/\//g, "_").replace(/\\/g, "_").replace(/\.\./g, "_");
    // Remove any remaining path-like characters
    safeId = safeId.replace(/[^a-zA-Z0-9_-]/g, "");

    if (!safeId) {
      console.warn(`Invalid workflow_id after sanitization: ${workflowId}`);
      return null;
    }

    const workflowPath = path.resolve(this.workflowDir, `${safeId}.json`);
    const resolvedDir = path.resolve(this.workflowDir);

    // Ensure the resolved path is within workflowDir
    if (!workflowPath.startsWith(resolvedDir)) {
      console.warn(`Path traversal attempt detected: ${workflowId}`);
      return null;
    }

    return fs.existsSync(workflowPath) ? workflowPath : null;
  }

  private _loadWorkflowMetadata(workflowPath: string): Record<string, any> {
    const metadataPath = workflowPath.replace(/\.json$/, ".meta.json");
    if (fs.existsSync(metadataPath)) {
      try {
        const content = fs.readFileSync(metadataPath, "utf-8");
        return JSON.parse(content);
      } catch (e) {
        console.warn(`Failed to load metadata for ${path.basename(workflowPath)}:`, e);
      }
    }
    return {};
  }

  /**
   * Get catalog of all available workflows with metadata.
   */
  public getWorkflowCatalog(): WorkflowCatalogEntry[] {
    const catalog: WorkflowCatalogEntry[] = [];

    if (!fs.existsSync(this.workflowDir)) {
      return catalog;
    }

    const files = fs.readdirSync(this.workflowDir);
    for (const file of files.sort()) {
      if (!file.endsWith(".json") || file.endsWith(".meta.json")) continue;

      const workflowPath = path.join(this.workflowDir, file);
      const workflowId = file.replace(".json", "");

      let workflow: Record<string, any>;
      try {
        const content = fs.readFileSync(workflowPath, "utf-8");
        workflow = JSON.parse(content);
      } catch {
        console.warn(`Skipping ${file}: invalid JSON`);
        continue;
      }

      // Load metadata
      const metadata = this._loadWorkflowMetadata(workflowPath);

      // Extract parameters
      const parameters = this._extractParameters(workflow);
      const availableInputs: Record<string, { type: string; required: boolean; description: string }> = {};

      for (const param of parameters) {
        availableInputs[param.name] = {
          type: param.annotation,
          required: param.required,
          description: param.description || PLACEHOLDER_DESCRIPTIONS[param.name] || `Value for '${param.name}'.`,
        };
      }

      catalog.push({
        id: workflowId,
        name:
          metadata.name ||
          workflowId
            .replace(/_/g, " ")
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        description: metadata.description || `Execute the '${workflowId}' workflow.`,
        available_inputs: availableInputs,
        defaults: metadata.defaults || {},
        updated_at: metadata.updated_at,
        hash: metadata.hash,
      });
    }

    return catalog;
  }

  private _discoverWorkflows(): void {
    if (!fs.existsSync(this.workflowDir)) {
      console.warn(`Workflow directory not found: ${this.workflowDir}`);
      return;
    }

    const files = fs.readdirSync(this.workflowDir);
    for (const file of files) {
      if (file.endsWith(".json") && !file.endsWith(".meta.json")) {
        const filePath = path.join(this.workflowDir, file);
        const stat = fs.statSync(filePath);
        const workflowId = file.replace(".json", "");
        this.workflows.set(workflowId, {
          path: filePath,
          mtime: stat.mtimeMs,
        });
      }
    }
  }

  public listWorkflows(): WorkflowToolDefinition[] {
    const result: WorkflowToolDefinition[] = [];

    for (const [workflowId] of this.workflows) {
      const workflow = this._loadWorkflow(workflowId);
      if (workflow) {
        result.push(workflow);
      }
    }

    return result;
  }

  public getWorkflow(workflowId: string): WorkflowToolDefinition | null {
    const safePath = this._safeWorkflowPath(workflowId);
    if (!safePath) return null;

    const workflowIdFromPath = path.basename(safePath, ".json");
    return this._loadWorkflow(workflowIdFromPath);
  }

  private _loadWorkflow(workflowId: string): WorkflowToolDefinition | null {
    const fileInfo = this.workflows.get(workflowId);
    if (!fileInfo) {
      return null;
    }

    // Check cache and mtime
    const cached = this.workflowCache.get(workflowId);
    if (cached) {
      const stat = fs.statSync(fileInfo.path);
      if (stat.mtimeMs <= fileInfo.mtime) {
        // Refresh if stale
        this._refreshDefinitionIfStale(cached);
        return cached;
      }
    }

    // Load and parse workflow
    try {
      const content = fs.readFileSync(fileInfo.path, "utf-8");
      const workflowData = JSON.parse(content);

      const toolDef = this._buildToolDefinition(workflowId, workflowData);
      if (toolDef) {
        this.workflowCache.set(workflowId, toolDef);
        // Update mtime
        const stat = fs.statSync(fileInfo.path);
        this.workflows.set(workflowId, { ...fileInfo, mtime: stat.mtimeMs });
        this.workflowMtime.set(workflowId, stat.mtimeMs);
      }

      return toolDef;
    } catch (error) {
      console.error(`Failed to load workflow ${workflowId}:`, error);
      return null;
    }
  }

  private _buildToolDefinition(workflowId: string, workflowData: Record<string, any>): WorkflowToolDefinition | null {
    // Extract parameters from workflow
    const parameters = this._extractParameters(workflowData);

    // If no parameters, this is a hardcoded test workflow - don't register
    if (parameters.length === 0) {
      return null;
    }

    // Build tool name
    const toolName = this._dedupeToolName(workflowId.replace(/-/g, "_").toLowerCase());

    // Extract prompt parameter to build description
    const promptParam = parameters.find((p) => p.name.toLowerCase().includes("prompt"));
    let description = `Execute workflow: ${workflowId}`;
    if (promptParam) {
      description = `Generate content using ${workflowId} workflow`;
    }

    // Extract output preferences
    const outputPreferences = this._extractOutputPreferences(workflowData);

    return {
      workflow_id: workflowId,
      tool_name: toolName,
      description,
      template: workflowData,
      parameters,
      output_preferences: outputPreferences,
    };
  }

  private _dedupeToolName(baseName: string): string {
    let name = baseName || "workflow_tool";
    if (!this.toolNames.has(name)) {
      this.toolNames.add(name);
      return name;
    }

    let suffix = 2;
    while (this.toolNames.has(`${name}_${suffix}`)) {
      suffix++;
    }
    const deduped = `${name}_${suffix}`;
    this.toolNames.add(deduped);
    return deduped;
  }

  private _refreshDefinitionIfStale(definition: WorkflowToolDefinition): void {
    const safePath = this._safeWorkflowPath(definition.workflow_id);
    if (!safePath) return;

    try {
      const currentMtime = fs.statSync(safePath).mtimeMs;
      const cachedMtime = this.workflowMtime.get(definition.workflow_id);

      if (cachedMtime !== undefined && cachedMtime === currentMtime) {
        return; // File hasn't changed
      }

      console.info(`Refreshing tool definition '${definition.workflow_id}' from disk`);
      const content = fs.readFileSync(safePath, "utf-8");
      const workflowData = JSON.parse(content);

      definition.template = workflowData;
      definition.parameters = this._extractParameters(workflowData);
      definition.output_preferences = this._extractOutputPreferences(workflowData);
      this.workflowMtime.set(definition.workflow_id, currentMtime);
    } catch (error) {
      console.error(`Failed to refresh workflow ${definition.workflow_id}:`, error);
    }
  }

  private _extractParameters(workflowData: Record<string, any>): WorkflowParameter[] {
    const parameters: Map<string, WorkflowParameter> = new Map();

    for (const [nodeId, nodeData] of Object.entries(workflowData)) {
      if (typeof nodeData !== "object" || !nodeData.inputs) continue;

      for (const [inputKey, inputValue] of Object.entries(nodeData.inputs)) {
        if (typeof inputValue === "string" && inputValue.startsWith(PLACEHOLDER_PREFIX)) {
          const parsed = this._parsePlaceholder(inputValue);
          if (!parsed) continue;

          const { name, annotation, placeholder, description } = parsed;

          if (!parameters.has(name)) {
            const required = !OPTIONAL_PARAMS.has(name);
            parameters.set(name, {
              name,
              placeholder,
              annotation,
              bindings: [`${nodeId}.${inputKey}`],
              required,
              description,
            });
          } else {
            const existing = parameters.get(name)!;
            if (!existing.bindings.includes(`${nodeId}.${inputKey}`)) {
              existing.bindings.push(`${nodeId}.${inputKey}`);
            }
          }
        }
      }
    }

    return Array.from(parameters.values());
  }

  private _parsePlaceholder(value: string): {
    name: string;
    annotation: string;
    placeholder: string;
    description: string;
  } | null {
    if (!value.startsWith(PLACEHOLDER_PREFIX)) return null;

    const token = value.slice(PLACEHOLDER_PREFIX.length);
    let annotation = "string";
    let paramName = token.toLowerCase();

    if (token.includes("_")) {
      const [typePart, ...nameParts] = token.split("_");
      const typeHint = PLACEHOLDER_TYPE_HINTS[typePart.toUpperCase()];
      if (typeHint) {
        annotation = typeHint;
        paramName = nameParts.join("_").toLowerCase();
      }
    }

    // Normalize name
    paramName =
      paramName
        .replace(/[^a-z0-9]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || "param";

    const description = PLACEHOLDER_DESCRIPTIONS[paramName] || `Value for '${paramName}'.`;

    return { name: paramName, annotation, placeholder: value, description };
  }

  private _extractOutputPreferences(workflowData: Record<string, any>): string[] {
    const preferences = new Set<string>();

    for (const [, nodeData] of Object.entries(workflowData)) {
      if (typeof nodeData !== "object") continue;
      const classType = String(nodeData.class_type || "").toLowerCase();

      if ("audio" in nodeData || classType.includes("audio")) {
        preferences.add("audio");
      }
      if ("video" in nodeData || classType.includes("video") || classType.includes("savevideo")) {
        preferences.add("video");
      }
      if (nodeData.class_type === "SaveImage" || classType.includes("saveimage")) {
        preferences.add("images");
      }
    }

    if (preferences.size === 0) {
      preferences.add("images");
    }

    return Array.from(preferences);
  }

  public renderWorkflow(
    workflowId: string,
    parameterValues: Record<string, any>,
    constrainedOverrides: Record<string, any> = {},
  ): Record<string, any> | null {
    const toolDef = this.getWorkflow(workflowId);
    if (!toolDef) {
      return null;
    }

    // Refresh template if file changed on disk
    this._refreshDefinitionIfStale(toolDef);

    // Deep clone the template
    const workflow = JSON.parse(JSON.stringify(toolDef.template));

    // Apply parameter values
    for (const param of toolDef.parameters) {
      let value = parameterValues[param.name];

      // Apply constrained overrides
      if (param.name in constrainedOverrides) {
        const overrideValue = constrainedOverrides[param.name];
        if (this._isValidType(overrideValue, param.annotation)) {
          value = overrideValue;
        }
      }

      // Coerce type
      value = this._coerceType(value, param.annotation);

      // Special handling for seed: -1 means random seed
      if (param.name === "seed" && typeof value === "number" && value < 0) {
        value = Math.floor(Math.random() * 2 ** 32);
      }

      // Apply to all bindings
      for (const binding of param.bindings) {
        const [nodeId, ...keyParts] = binding.split(".");
        const key = keyParts.join(".");

        if (workflow[nodeId] && workflow[nodeId].inputs && key in workflow[nodeId].inputs) {
          workflow[nodeId].inputs[key] = value;
        }
      }
    }

    return workflow;
  }

  private _isValidType(value: any, annotation: string): boolean {
    if (value === undefined || value === null) return false;

    switch (annotation) {
      case "integer":
        return Number.isInteger(value);
      case "number":
        return typeof value === "number";
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      default:
        return true;
    }
  }

  private _coerceType(value: any, annotation: string): any {
    if (value === undefined || value === null) return value;

    switch (annotation) {
      case "integer":
        return typeof value === "string" ? parseInt(value, 10) : Math.floor(Number(value));
      case "number":
        return typeof value === "string" ? parseFloat(value) : Number(value);
      case "string":
        return String(value);
      case "boolean":
        if (typeof value === "string") {
          return value.toLowerCase() === "true" || value === "1";
        }
        return Boolean(value);
      default:
        return value;
    }
  }
}
