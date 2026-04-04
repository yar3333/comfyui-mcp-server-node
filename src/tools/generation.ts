import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyUIClient } from "../comfyui_client";
import { WorkflowManager } from "../managers/workflow_manager";
import { DefaultsManager } from "../managers/defaults_manager";
import { AssetRegistry } from "../managers/asset_registry";
import { registerAndBuildResponse } from "./helpers";
import * as z from "zod";

export function registerWorkflowGenerationTools(
  server: McpServer,
  workflowManager: WorkflowManager,
  client: ComfyUIClient,
  defaultsManager: DefaultsManager,
  assetRegistry: AssetRegistry,
): void {
  const workflows = workflowManager.listWorkflows();

  for (const workflow of workflows) {
    const paramSchema: Record<string, any> = {};

    for (const param of workflow.parameters) {
      let schemaType: any = z.string();
      switch (param.annotation) {
        case "integer":
        case "number":
          schemaType = z.number();
          break;
        case "string":
          schemaType = z.string();
          break;
      }
      paramSchema[param.name] = param.required
        ? schemaType.describe(`Workflow parameter: ${param.name}`)
        : schemaType.optional().describe(`Workflow parameter: ${param.name}`);
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

          const defaults: Record<string, any> = {};
          for (const param of workflow.parameters) {
            const defaultValue = defaultsManager.get(param.name);
            if (defaultValue !== undefined) defaults[param.name] = defaultValue;
          }

          const renderedWorkflow = workflowManager.renderWorkflow(workflow.workflow_id, args, defaults);
          if (!renderedWorkflow) {
            return {
              content: [{ type: "text", text: `Failed to render workflow: ${workflow.workflow_id}` }],
              isError: true,
            };
          }

          const result = await client.runCustomWorkflow(renderedWorkflow, workflow.output_preferences);
          if (result.status === "running") {
            return { content: [{ type: "text", text: result.message || "Workflow is still running" }] };
          }

          const assetResponse = await registerAndBuildResponse(
            assetRegistry,
            result,
            workflow.workflow_id,
            returnInlinePreview,
          );
          return { content: [{ type: "text", text: JSON.stringify(assetResponse, null, 2) }] };
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

        const workflow = JSON.parse(JSON.stringify(asset.submitted_workflow));
        const overrides = args.param_overrides || {};
        if (args.seed !== undefined) overrides.seed = args.seed;

        updateWorkflowParams(workflow, overrides);
        if (args.seed !== undefined) updateSeed(workflow, args.seed);

        const result = await client.runCustomWorkflow(workflow);
        if (result.status === "running") {
          return { content: [{ type: "text", text: result.message || "Workflow is still running" }] };
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

function updateWorkflowParams(workflow: Record<string, any>, overrides: Record<string, any>): void {
  for (const [paramName, paramValue] of Object.entries(overrides)) {
    for (const [, nodeData] of Object.entries(workflow)) {
      if (typeof nodeData !== "object" || !nodeData.inputs) continue;
      for (const [inputKey, inputValue] of Object.entries(nodeData.inputs)) {
        if (
          typeof inputValue === "string" &&
          inputValue.includes(`PARAM_`) &&
          inputValue.toLowerCase().includes(paramName.toLowerCase())
        ) {
          nodeData.inputs[inputKey] = paramValue;
        }
      }
    }
  }
}

function updateSeed(workflow: Record<string, any>, seed: number): void {
  for (const [, nodeData] of Object.entries(workflow)) {
    if (typeof nodeData !== "object" || !nodeData.inputs) continue;
    if ("seed" in nodeData.inputs) nodeData.inputs.seed = seed;
    if ("noise_seed" in nodeData.inputs) nodeData.inputs.noise_seed = seed;
  }
}
