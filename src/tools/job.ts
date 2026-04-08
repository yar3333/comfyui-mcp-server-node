import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComfyUIClient } from "../comfyui_client";
import { AssetRegistry } from "../managers/asset_registry";
import * as z from "zod";

export function registerJobTools(server: McpServer, client: ComfyUIClient, assetRegistry: AssetRegistry): void {
  server.registerTool(
    "get_queue_status",
    { description: "Get current queue status from ComfyUI", inputSchema: z.object({}) },
    async () => {
      try {
        const queue = await client.getQueue();
        return { content: [{ type: "text", text: JSON.stringify(queue, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_job",
    {
      description: "Get job status by prompt_id. Checks queue first, then history.",
      inputSchema: z.object({ prompt_id: z.string().describe("The prompt ID of the job") }),
    },
    async (args: any) => {
      try {
        // Check queue first (like Python version)
        const queue = await client.getQueue();
        const runningJobs = queue?.queue_running || [];
        const pendingJobs = queue?.queue_pending || [];

        // Check if job is in running queue
        for (const job of runningJobs) {
          if (job[1] === args.prompt_id) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ status: "running", prompt_id: args.prompt_id, queue_position: -1 }, null, 2),
                },
              ],
            };
          }
        }

        // Check if job is in pending queue
        for (const job of pendingJobs) {
          if (job[1] === args.prompt_id) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { status: "queued", prompt_id: args.prompt_id, queue_position: job[0] },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        }

        // Not in queue, check history
        const history = await client.getHistory(args.prompt_id);
        if (!history || !(args.prompt_id in history)) {
          return { content: [{ type: "text", text: `Job not found: ${args.prompt_id}` }], isError: true };
        }

        const jobData = history[args.prompt_id];
        const statusStr = jobData.status?.status_str || "unknown";
        return {
          content: [{ type: "text", text: JSON.stringify(jobData, null, 2) }],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_assets",
    {
      description: "List generated assets with optional filtering",
      inputSchema: z.object({
        limit: z.number().optional().describe("Maximum number of assets to return"),
        workflow_id: z.string().optional().describe("Filter by workflow ID"),
        session_id: z.string().optional().describe("Filter by session ID"),
      }),
    },
    async (args: any) => {
      try {
        const limit = args.limit || 100;
        const assets = assetRegistry.listAssets(limit, args.workflow_id || null, args.session_id || null);
        const assetList = assets.map((asset) => ({
          asset_id: asset.asset_id,
          asset_url: assetRegistry.getAssetUrl(asset),
          filename: asset.filename,
          width: asset.width,
          height: asset.height,
          mime_type: asset.mime_type,
          bytes_size: asset.bytes_size,
          workflow_id: asset.workflow_id,
          session_id: asset.session_id,
          created_at: asset.created_at.toISOString(),
        }));
        return { content: [{ type: "text", text: JSON.stringify(assetList, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "get_asset_metadata",
    {
      description: "Get full metadata for a specific asset",
      inputSchema: z.object({ asset_id: z.string().describe("The asset ID") }),
    },
    async (args: any) => {
      try {
        const asset = assetRegistry.getAsset(args.asset_id);
        if (!asset) {
          return { content: [{ type: "text", text: `Asset not found: ${args.asset_id}` }], isError: true };
        }
        const metadata = {
          asset_id: asset.asset_id,
          asset_url: assetRegistry.getAssetUrl(asset),
          filename: asset.filename,
          subfolder: asset.subfolder,
          folder_type: asset.folder_type,
          width: asset.width,
          height: asset.height,
          mime_type: asset.mime_type,
          bytes_size: asset.bytes_size,
          workflow_id: asset.workflow_id,
          prompt_id: asset.prompt_id,
          created_at: asset.created_at.toISOString(),
          expires_at: asset.expires_at.toISOString(),
          comfy_history: asset.comfy_history,
          submitted_workflow: asset.submitted_workflow,
        };
        return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "cancel_job",
    {
      description: "Cancel a running job by prompt_id",
      inputSchema: z.object({ prompt_id: z.string().describe("The prompt ID of the job to cancel") }),
    },
    async (args: any) => {
      try {
        const cancelled = await client.cancelPrompt(args.prompt_id);
        return {
          content: [
            {
              type: "text",
              text: cancelled
                ? `Job ${args.prompt_id} cancelled successfully`
                : `Failed to cancel job ${args.prompt_id}`,
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );

  server.registerTool(
    "wait_for_job",
    {
      description: "Wait for a job to complete. Polls the job status until it finishes or timeout is reached.",
      inputSchema: z.object({
        prompt_id: z.string().describe("The prompt ID of the job to wait for"),
        timeout: z.number().optional().default(600).describe("Maximum time to wait in seconds (default: 600)"),
      }),
    },
    async (args: any) => {
      const { prompt_id, timeout } = args;
      const maxTimeMs = timeout * 1000;
      const pollIntervalMs = 15 * 1000;
      const startTime = Date.now();

      try {
        let lastStatus: string | null = null;

        while (Date.now() - startTime < maxTimeMs) {
          const queue = await client.getQueue();
          const runningJobs = queue?.queue_running || [];
          const pendingJobs = queue?.queue_pending || [];

          // Check if job is still in queue
          let jobInQueue = false;
          for (const job of [...runningJobs, ...pendingJobs]) {
            if (job[1] === prompt_id) {
              jobInQueue = true;
              const status = runningJobs.includes(job) ? "running" : "queued";
              lastStatus = status;
              break;
            }
          }

          if (jobInQueue) {
            // Job still in queue, wait and poll again
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = Math.floor((maxTimeMs - (Date.now() - startTime)) / 1000);
            console.info(`Job ${prompt_id} still ${lastStatus}. Elapsed: ${elapsed}s, Remaining: ${remaining}s`);
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            continue;
          }

          // Not in queue, check history
          const history = await client.getHistory(prompt_id);
          if (history && prompt_id in history) {
            const jobData = history[prompt_id];
            const statusStr = jobData.status?.status_str || "unknown";

            if (statusStr === "success" || statusStr === "error") {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        status: "completed",
                        prompt_id,
                        final_status: statusStr,
                        elapsed_seconds: elapsed,
                        job_data: jobData,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
          }

          // Job not found yet, wait and retry
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }

        // Timeout reached
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "timeout",
                  prompt_id,
                  timeout_seconds: timeout,
                  message: `Job ${prompt_id} did not complete within ${timeout} seconds. Use get_job to check status.`,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
    },
  );
}
