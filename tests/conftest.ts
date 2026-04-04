// Shared test fixtures and mocks
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import sharp from "sharp";

export const FIXTURES_DIR = path.join(__dirname, "fixtures");

export function ensureFixturesDir() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }
  return FIXTURES_DIR;
}

export function createTempDir(prefix: string = "test-"): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return tempDir;
}

export function cleanupTempDir(dir: string) {
  if (fs.existsSync(dir)) {
    try {
      // Windows may have file locks, retry a few times
      for (let i = 0; i < 3; i++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          break;
        } catch {
          // Wait a bit and retry
          const start = Date.now();
          while (Date.now() - start < 100) {
            /* spin wait */
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export function createMockWorkflowFile(dir: string, filename: string, workflowData: Record<string, any>) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(workflowData, null, 2));
  return filePath;
}

export function createMockWorkflowData(): Record<string, any> {
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

/**
 * Generates a valid PNG image buffer using sharp (cross-platform compatible).
 */
export async function createMockImageBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 128, g: 64, b: 192 },
    },
  })
    .png()
    .toBuffer();
}

export function createMockConfigFile(dir: string, filename: string, config: Record<string, any>): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  return filePath;
}
