import { WorkflowManager } from "../src/managers/workflow_manager";
import { createTempDir, cleanupTempDir, createMockWorkflowFile, createMockWorkflowData } from "./conftest";

describe("Bug Fixes and Edge Cases", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir("bugfix-test-");
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe("Workflow path traversal protection", () => {
    it("should sanitize workflow IDs with path separators", () => {
      const manager = new WorkflowManager(tempDir);

      // These should all be safely handled
      const maliciousIds = ["../../etc/passwd", "..\\..\\windows\\system32", "workflow/../../secret"];

      for (const id of maliciousIds) {
        const result = manager.getWorkflow(id);
        expect(result).toBeNull();
      }
    });
  });

  describe("Type coercion in renderWorkflow", () => {
    it("should coerce string numbers to integers", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      const rendered = manager.renderWorkflow(
        workflows[0].workflow_id,
        { prompt: "test", seed: "12345", steps: "30" },
        {},
      );

      expect(rendered!["3"].inputs.seed).toBe(12345);
      expect(typeof rendered!["3"].inputs.seed).toBe("number");
      expect(rendered!["3"].inputs.steps).toBe(30);
      expect(typeof rendered!["3"].inputs.steps).toBe("number");
    });

    it("should coerce string numbers to floats", () => {
      createMockWorkflowFile(tempDir, "test.json", createMockWorkflowData());
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      const rendered = manager.renderWorkflow(workflows[0].workflow_id, { cfg: "7.5" }, {});

      expect(rendered!["5"].inputs.cfg).toBe(7.5);
      expect(typeof rendered!["5"].inputs.cfg).toBe("number");
    });
  });

  describe("Parameter binding to multiple nodes", () => {
    it("should apply parameter to all bindings", () => {
      const workflowData = {
        "3": {
          inputs: { text: "PARAM_PROMPT" },
          class_type: "CLIPTextEncode",
        },
        "6": {
          inputs: { text: "PARAM_PROMPT" },
          class_type: "CLIPTextEncode",
        },
      };

      createMockWorkflowFile(tempDir, "multi_binding.json", workflowData);
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      const promptParam = workflows[0].parameters.find((p) => p.name === "prompt");
      expect(promptParam?.bindings.length).toBe(2);

      const rendered = manager.renderWorkflow(workflows[0].workflow_id, { prompt: "shared prompt" }, {});

      expect(rendered!["3"].inputs.text).toBe("shared prompt");
      expect(rendered!["6"].inputs.text).toBe("shared prompt");
    });
  });

  describe("Empty and malformed workflows", () => {
    it("should skip workflows with no parameters", () => {
      const emptyWorkflow = {
        "1": { inputs: {}, class_type: "SomeNode" },
      };

      createMockWorkflowFile(tempDir, "empty.json", emptyWorkflow);
      const manager = new WorkflowManager(tempDir);
      const workflows = manager.listWorkflows();

      expect(workflows.length).toBe(0);
    });

    it("should handle malformed JSON gracefully", () => {
      require("fs").writeFileSync(`${tempDir}/broken.json`, "{broken json}");
      const manager = new WorkflowManager(tempDir);

      // Should not throw
      const workflows = manager.listWorkflows();
      expect(workflows.length).toBe(0);
    });
  });
});
