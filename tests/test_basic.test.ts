import { WorkflowManager } from "../src/managers/workflow_manager";
import { createMockWorkflowData, createTempDir, cleanupTempDir, createMockWorkflowFile } from "./conftest";

describe("WorkflowManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("workflow-test-");
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("_discoverWorkflows", () => {
    it("should discover workflow JSON files", () => {
      createMockWorkflowFile(tempDir, "test_workflow.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      expect(workflows.length).toBe(1);
      expect(workflows[0].workflow_id).toBe("test_workflow");
    });

    it("should handle empty workflow directory", () => {
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      expect(workflows).toEqual([]);
    });

    it("should skip non-JSON files", () => {
      // Create a non-JSON file
      require("fs").writeFileSync(`${tempDir}/not_a_workflow.txt`, "hello");
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      expect(workflows.length).toBe(0);
    });
  });

  describe("_extractParameters", () => {
    it("should extract PARAM_* placeholders", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      expect(workflows.length).toBe(1);

      const params = workflows[0].parameters;
      const paramNames = params.map((p) => p.name);
      expect(paramNames).toContain("prompt");
      expect(paramNames).toContain("seed");
      expect(paramNames).toContain("steps");
      expect(paramNames).toContain("cfg");
      expect(paramNames).toContain("sampler_name");
      expect(paramNames).toContain("width");
      expect(paramNames).toContain("height");
    });

    it("should correctly identify required parameters", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      const promptParam = workflows[0].parameters.find((p) => p.name === "prompt");
      expect(promptParam?.required).toBe(true);
    });

    it("should correctly type integer parameters", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      const seedParam = workflows[0].parameters.find((p) => p.name === "seed");
      expect(seedParam?.annotation).toBe("integer");
    });

    it("should correctly type float parameters", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();
      const cfgParam = workflows[0].parameters.find((p) => p.name === "cfg");
      expect(cfgParam?.annotation).toBe("number");
    });
  });

  describe("renderWorkflow", () => {
    it("should substitute parameter values", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      const rendered = manager.renderWorkflow(
        workflows[0].workflow_id,
        { prompt: "a cat", seed: 42, steps: 30 },
        { cfg: 7.0, sampler_name: "euler" },
      );

      expect(rendered).not.toBeNull();
      expect(rendered!["3"].inputs.text).toBe("a cat");
      expect(rendered!["3"].inputs.seed).toBe(42);
      expect(rendered!["3"].inputs.steps).toBe(30);
    });

    it("should coerce types correctly", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      const rendered = manager.renderWorkflow(
        workflows[0].workflow_id,
        { seed: "42", cfg: "7.5" },
        {},
      );

      expect(rendered).not.toBeNull();
      expect(rendered!["3"].inputs.seed).toBe(42);
      expect(rendered!["5"].inputs.cfg).toBe(7.5);
    });

    it("should fall back to defaults when values not provided", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      const rendered = manager.renderWorkflow(
        workflows[0].workflow_id,
        { prompt: "test" },
        { seed: 123, steps: 25, cfg: 8.0 },
      );

      expect(rendered!["3"].inputs.seed).toBe(123);
      expect(rendered!["3"].inputs.steps).toBe(25);
    });

    it("should return null for unknown workflow", () => {
      const manager = new WorkflowManager(tempDir);
      const result = manager.renderWorkflow("nonexistent", {}, {});
      expect(result).toBeNull();
    });
  });

  describe("path traversal protection", () => {
    it("should sanitize workflow IDs to prevent path traversal", () => {
      // The manager should handle malicious workflow IDs safely
      const manager = new WorkflowManager(tempDir);
      // Attempting to get workflow with path traversal should not crash
      const result = manager.getWorkflow("../../etc/passwd");
      expect(result).toBeNull();
    });
  });
});
