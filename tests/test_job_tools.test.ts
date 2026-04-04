import { registerJobTools } from "../src/tools/job";
import { AssetRegistry } from "../src/managers/asset_registry";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock ComfyUIClient
const mockClient = {
  getQueue: jest.fn(),
  getHistory: jest.fn(),
  cancelPrompt: jest.fn(),
  getAvailableModels: jest.fn(),
  runCustomWorkflow: jest.fn(),
};

describe("Job Tools", () => {
  let server: McpServer;
  let assetRegistry: AssetRegistry;

  beforeEach(() => {
    server = {
      registerTool: jest.fn(),
    } as unknown as McpServer;

    assetRegistry = new AssetRegistry(24, "http://localhost:8188");
    jest.clearAllMocks();
  });

  describe("registerJobTools", () => {
    it("should register all job-related tools", () => {
      registerJobTools(server, mockClient as any, assetRegistry);

      const registeredTools = (server.registerTool as jest.Mock).mock.calls.map((call: any[]) => call[0]);

      expect(registeredTools).toContain("get_queue_status");
      expect(registeredTools).toContain("get_job");
      expect(registeredTools).toContain("list_assets");
      expect(registeredTools).toContain("get_asset_metadata");
      expect(registeredTools).toContain("cancel_job");
    });
  });

  describe("get_queue_status", () => {
    it("should return queue status from client", async () => {
      mockClient.getQueue.mockResolvedValue({
        queue_running: [],
        queue_pending: [],
      });

      registerJobTools(server, mockClient as any, assetRegistry);

      const registerCall = (server.registerTool as jest.Mock).mock.calls.find(
        (call: any[]) => call[0] === "get_queue_status",
      );

      const handler = registerCall[2];
      const result = await handler({});

      expect(result.content[0].text).toContain("queue_running");
    });
  });

  describe("get_job", () => {
    it("should return job not found for unknown prompt_id", async () => {
      mockClient.getHistory.mockResolvedValue({});

      registerJobTools(server, mockClient as any, assetRegistry);

      const registerCall = (server.registerTool as jest.Mock).mock.calls.find((call: any[]) => call[0] === "get_job");

      const handler = registerCall[2];
      const result = await handler({ prompt_id: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("should return job status when found", async () => {
      const promptId = "test-prompt-001";
      mockClient.getHistory.mockResolvedValue({
        [promptId]: {
          status: { status_str: "success", completed: true },
          outputs: {},
        },
      });

      registerJobTools(server, mockClient as any, assetRegistry);

      const registerCall = (server.registerTool as jest.Mock).mock.calls.find((call: any[]) => call[0] === "get_job");

      const handler = registerCall[2];
      const result = await handler({ prompt_id: promptId });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("success");
    });
  });

  describe("list_assets", () => {
    it("should return list of assets", async () => {
      assetRegistry.registerAsset(
        "img1.png",
        "",
        "output",
        "p1",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );
      assetRegistry.registerAsset(
        "img2.png",
        "",
        "output",
        "p2",
        "generate_image",
        { mime_type: "image/png" },
        null,
        null,
      );

      registerJobTools(server, mockClient as any, assetRegistry);

      const registerCall = (server.registerTool as jest.Mock).mock.calls.find(
        (call: any[]) => call[0] === "list_assets",
      );

      const handler = registerCall[2];
      const result = await handler({ limit: 10 });
      const assets = JSON.parse(result.content[0].text);

      expect(assets.length).toBe(2);
    });
  });

  describe("cancel_job", () => {
    it("should return success when job cancelled", async () => {
      mockClient.cancelPrompt.mockResolvedValue(true);

      registerJobTools(server, mockClient as any, assetRegistry);

      const registerCall = (server.registerTool as jest.Mock).mock.calls.find(
        (call: any[]) => call[0] === "cancel_job",
      );

      const handler = registerCall[2];
      const result = await handler({ prompt_id: "test-prompt" });

      expect(result.content[0].text).toContain("cancelled successfully");
    });
  });
});
