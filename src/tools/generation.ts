import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyUIClient } from "../comfyui_client";
import { WorkflowManager } from "../managers/workflow_manager";
import { AssetRegistry } from "../managers/asset_registry";
import { registerAndBuildResponse } from "./helpers";
import * as z from "zod";

// Mapping of parameter names to node class_types that typically contain them
const PARAM_CLASS_TYPES: Record<string, string[]> = {
  prompt: ["CLIPTextEncode", "CLIPTextEncodeSDXL", "CR Prompt Text"],
  negative_prompt: ["CLIPTextEncode", "CLIPTextEncodeSDXL"],
  seed: ["KSampler", "KSamplerAdvanced", "PrimitiveNode"],
  noise_seed: ["KSampler", "KSamplerAdvanced"],
  steps: ["KSampler", "KSamplerAdvanced"],
  cfg: ["KSampler", "KSamplerAdvanced"],
  sampler_name: ["KSampler", "KSamplerAdvanced"],
  sampler: ["KSampler", "KSamplerAdvanced"],
  scheduler: ["KSampler", "KSamplerAdvanced"],
  denoise: ["KSampler", "KSamplerAdvanced"],
  width: ["EmptyLatentImage", "EmptySD3LatentImage"],
  height: ["EmptyLatentImage", "EmptySD3LatentImage"],
  batch_size: ["EmptyLatentImage", "EmptySD3LatentImage"],
  model: ["CheckpointLoaderSimple", "CheckpointLoader", "UNETLoader"],
  ckpt_name: ["CheckpointLoaderSimple", "CheckpointLoader"],
  tags: ["AceStepGeneration", "AceStepPipeline"],
  lyrics: ["AceStepGeneration"],
  lyrics_strength: ["AceStepGeneration"],
  seconds: ["AceStepGeneration"],
  duration: ["VideoHelper", "SaveAnimatedWEBP"],
  fps: ["VideoHelper", "SaveAnimatedWEBP"],
};

export function registerWorkflowGenerationTools(
  server: McpServer,
  workflowManager: WorkflowManager,
  client: ComfyUIClient,
  assetRegistry: AssetRegistry,
): void {
  const workflows = workflowManager.listWorkflows();

  for (const workflow of workflows) {
    const paramSchema: Record<string, any> = {};

    for (const param of workflow.parameters) {
      let schemaType: z.ZodTypeAny = z.string();
      switch (param.annotation) {
        case "integer":
          schemaType = z.number().int();
          break;
        case "number":
          schemaType = z.number();
          break;
        case "string":
          schemaType = z.string();
          break;
      }

      if (param.required) {
        paramSchema[param.name] = schemaType.describe(`Workflow parameter: ${param.name}`);
      } else {
        paramSchema[param.name] = schemaType.optional().describe(`Workflow parameter: ${param.name}`);
      }
    }

    paramSchema.return_inline_preview = z.boolean().optional().describe("Return inline preview of the generated asset");

    server.registerTool(
      workflow.tool_name,
      {
        description: workflow.description,
        inputSchema: z.object(paramSchema),
      },
      async (args: Record<string, any>) => {
        try {
          const returnInlinePreview = args.return_inline_preview || false;
          delete args.return_inline_preview;

          // Build defaults from defaultsManager
          const namespace = _determineNamespace(workflow.workflow_id);

          // Type coerce provided args
          const coercedArgs = _coerceParams(args, workflow.parameters);

          const renderedWorkflow = workflowManager.renderWorkflow(workflow.workflow_id, coercedArgs);
          if (!renderedWorkflow) {
            return {
              content: [{ type: "text", text: `Failed to render workflow: ${workflow.workflow_id}` }],
              isError: true,
            };
          }

          const result = await client.runCustomWorkflow(renderedWorkflow, workflow.output_preferences);

          if (result.status === "running") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "running",
                      message: result.message || "Workflow is running, use get_job to check status",
                      prompt_id: result.prompt_id,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          const assetResponse = await registerAndBuildResponse(
            assetRegistry,
            result,
            workflow.workflow_id,
            returnInlinePreview,
          );

          return {
            content: [{ type: "text", text: JSON.stringify(assetResponse, null, 2) }],
          };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
        }
      },
    );
  }
}

export function registerRegenerateTool(server: McpServer, client: ComfyUIClient, assetRegistry: AssetRegistry): void {
  server.registerTool(
    "regenerate",
    {
      description: "Regenerate a previously generated asset with optional parameter overrides",
      inputSchema: z.object({
        asset_id: z.string().describe("ID of the asset to regenerate"),
        seed: z.number().optional().describe("New seed value (optional)"),
        return_inline_preview: z.boolean().optional().describe("Return inline preview"),
        param_overrides: z.record(z.string(), z.any()).optional().describe("Parameter overrides as key-value pairs"),
      }),
    },
    async (args: any) => {
      try {
        const asset = assetRegistry.getAsset(args.asset_id);
        if (!asset) {
          return { content: [{ type: "text", text: `Asset not found: ${args.asset_id}` }], isError: true };
        }

        if (!asset.submitted_workflow) {
          return { content: [{ type: "text", text: "No workflow found for this asset" }], isError: true };
        }

        // Deep clone the submitted workflow
        const workflow = JSON.parse(JSON.stringify(asset.submitted_workflow));
        const overrides = args.param_overrides || {};
        if (args.seed !== undefined) overrides.seed = args.seed;

        // Apply overrides using class_type matching (like Python version)
        updateWorkflowParamsByClassType(workflow, overrides);

        // Also update seed in KSampler nodes if provided
        if (args.seed !== undefined) {
          updateSeedInKSampler(workflow, args.seed);
        }

        const result = await client.runCustomWorkflow(workflow);
        if (result.status === "running") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "running",
                    message: result.message || "Workflow is running",
                    prompt_id: result.prompt_id,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const assetResponse = await registerAndBuildResponse(
          assetRegistry,
          result,
          asset.workflow_id,
          args.return_inline_preview || false,
        );
        return { content: [{ type: "text", text: JSON.stringify(assetResponse, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );
}

/**
 * Update workflow parameters by matching node class_type (like Python version).
 * This is more reliable than PARAM_ placeholder matching for regenerate.
 */
function updateWorkflowParamsByClassType(workflow: Record<string, any>, overrides: Record<string, any>): void {
  for (const [paramName, paramValue] of Object.entries(overrides)) {
    const classTypes = PARAM_CLASS_TYPES[paramName];
    if (!classTypes || classTypes.length === 0) continue;

    for (const [, nodeData] of Object.entries(workflow)) {
      if (typeof nodeData !== "object" || !nodeData.class_type) continue;

      const classType = nodeData.class_type;
      if (classTypes.includes(classType)) {
        // Find the matching input key for this parameter
        const inputKey = _findInputKeyForParam(classType, paramName);
        if (inputKey && nodeData.inputs && inputKey in nodeData.inputs) {
          nodeData.inputs[inputKey] = paramValue;
        }
      }
    }
  }
}

/**
 * Find the input key in a node's inputs that corresponds to a parameter name.
 */
function _findInputKeyForParam(classType: string, paramName: string): string | null {
  // Direct mapping for common parameters
  const inputMap: Record<string, Record<string, string>> = {
    CLIPTextEncode: { prompt: "text", negative_prompt: "text" },
    CLIPTextEncodeSDXL: { prompt: "text", negative_prompt: "text" },
    "CR Prompt Text": { prompt: "prompt" },
    KSampler: {
      seed: "seed",
      noise_seed: "seed",
      steps: "steps",
      cfg: "cfg",
      sampler_name: "sampler_name",
      sampler: "sampler_name",
      scheduler: "scheduler",
      denoise: "denoise",
    },
    KSamplerAdvanced: {
      seed: "noise_seed",
      noise_seed: "noise_seed",
      steps: "steps",
      cfg: "cfg",
      sampler_name: "sampler_name",
      scheduler: "scheduler",
      denoise: "denoise",
    },
    EmptyLatentImage: { width: "width", height: "height", batch_size: "batch_size" },
    EmptySD3LatentImage: { width: "width", height: "height", batch_size: "batch_size" },
    CheckpointLoaderSimple: { model: "ckpt_name", ckpt_name: "ckpt_name" },
    CheckpointLoader: { model: "ckpt_name", ckpt_name: "ckpt_name" },
    UNETLoader: { model: "unet_name" },
    AceStepGeneration: {
      tags: "tags",
      lyrics: "lyrics",
      lyrics_strength: "lyrics_strength",
      seconds: "seconds",
      seed: "seed",
      steps: "steps",
      cfg: "cfg",
    },
    AceStepPipeline: { tags: "tags", seed: "seed" },
    PrimitiveNode: { seed: "value", noise_seed: "value" },
    VideoHelper: { duration: "duration", fps: "fps" },
    SaveAnimatedWEBP: { fps: "fps" },
  };

  const classMap = inputMap[classType];
  if (classMap && classMap[paramName]) {
    return classMap[paramName];
  }

  // Fallback: look for matching key in any node inputs
  return null;
}

/**
 * Update seed specifically in KSampler nodes.
 */
function updateSeedInKSampler(workflow: Record<string, any>, seed: number): void {
  const kSamplerTypes = ["KSampler", "KSamplerAdvanced", "PrimitiveNode"];

  for (const [, nodeData] of Object.entries(workflow)) {
    if (typeof nodeData !== "object" || !nodeData.class_type) continue;

    if (kSamplerTypes.includes(nodeData.class_type)) {
      if (nodeData.inputs) {
        if ("seed" in nodeData.inputs) {
          nodeData.inputs.seed = seed;
        } else if ("noise_seed" in nodeData.inputs) {
          nodeData.inputs.noise_seed = seed;
        } else if ("value" in nodeData.inputs) {
          // PrimitiveNode
          nodeData.inputs.value = seed;
        }
      }
    }
  }
}

/**
 * Coerce parameter values to correct types based on parameter annotations.
 */
function _coerceParams(
  args: Record<string, any>,
  parameters: Array<{ name: string; annotation: string }>,
): Record<string, any> {
  const coerced: Record<string, any> = { ...args };

  for (const param of parameters) {
    if (!(param.name in coerced)) continue;

    const value = coerced[param.name];
    coerced[param.name] = _coerceValue(value, param.annotation);
  }

  return coerced;
}

function _coerceValue(value: any, annotation: string): any {
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

function _determineNamespace(workflowId: string): "image" | "audio" | "video" {
  if (workflowId === "generate_song") return "audio";
  if (workflowId === "generate_video") return "video";
  return "image";
}
