// Global test setup
import * as path from "path";

// Increase timeout for tests that involve file I/O
jest.setTimeout(30000);

// Mock console methods to reduce noise during tests
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

beforeAll(() => {
  console.warn = jest.fn();
  console.info = jest.fn();
});

afterAll(() => {
  console.warn = originalConsoleWarn;
  console.info = originalConsoleInfo;
});

// Global test utilities
export function createMockAsset(overrides: Partial<Record<string, any>> = {}) {
  return {
    asset_id: "test-asset-001",
    filename: "ComfyUI_00001_.png",
    subfolder: "",
    folder_type: "output",
    prompt_id: "test-prompt-001",
    workflow_id: "generate_image",
    width: 512,
    height: 512,
    mime_type: "image/png",
    bytes_size: 12345,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    session_id: "test-session-001",
    comfy_history: null,
    submitted_workflow: null,
    ...overrides,
  };
}

export function createMockWorkflowData() {
  return {
    "3": {
      inputs: {
        text: "PARAM_PROMPT",
        seed: "PARAM_INT_SEED",
        steps: "PARAM_INT_STEPS",
      },
      class_type: "CLIPTextEncode",
    },
    "4": {
      inputs: {
        width: "PARAM_INT_WIDTH",
        height: "PARAM_INT_HEIGHT",
      },
      class_type: "EmptyLatentImage",
    },
    "5": {
      inputs: {
        cfg: "PARAM_FLOAT_CFG",
        sampler_name: "PARAM_STR_SAMPLER_NAME",
      },
      class_type: "KSampler",
    },
  };
}
