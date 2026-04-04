import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WorkflowManager } from "../managers/workflow_manager";
import { ComfyUIClient } from "../comfyui_client";
import { DefaultsManager } from "../managers/defaults_manager";
import { AssetRegistry } from "../managers/asset_registry";
import { registerAndBuildResponse } from "./helpers";
import * as z from "zod";

export function registerWorkflowTools(
  server: McpServer,
  workflowManager: WorkflowManager,
  client: ComfyUIClient,
  defaultsManager: DefaultsManager,
  assetRegistry: AssetRegistry,
): void {
  server.registerTool(
    "list_workflows",
    {
      description: "List available workflows in the workflow directory",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const workflows = workflowManager.listWorkflows();
        const workflowList = workflows.map((workflow) => ({
          workflow_id: workflow.workflow_id,
          tool_name: workflow.tool_name,
          description: workflow.description,
          parameters: workflow.parameters.map((p) => ({
            name: p.name,
            type: p.annotation,
            required: p.required,
          })),
        }));
        return { content: [{ type: "text", text: JSON.stringify(workflowList, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "run_workflow",
    {
      description: "Run a specific workflow with parameter overrides",
      inputSchema: z.object({
        workflow_id: z.string().describe("ID of the workflow to run"),
        overrides: z.record(z.string(), z.any()).optional().describe("Parameter overrides as key-value pairs"),
        options: z.record(z.string(), z.any()).optional().describe("Execution options"),
        return_inline_preview: z.boolean().optional().describe("Return inline preview of the generated asset"),
      }),
    },
    async (args: any) => {
      try {
        const workflow = workflowManager.getWorkflow(args.workflow_id);
        if (!workflow) {
          return { content: [{ type: "text", text: `Workflow not found: ${args.workflow_id}` }], isError: true };
        }

        const overrides = args.overrides || {};
        const returnInlinePreview = args.return_inline_preview || false;

        const defaults: Record<string, any> = {};
        for (const param of workflow.parameters) {
          const defaultValue = defaultsManager.get(param.name);
          if (defaultValue !== undefined) defaults[param.name] = defaultValue;
        }

        const renderedWorkflow = workflowManager.renderWorkflow(workflow.workflow_id, overrides, defaults, overrides);
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
