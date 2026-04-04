// Shared test fixtures and mocks
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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

export function createMockImageBuffer(): Buffer {
  // Minimal 1x1 PNG (valid PNG bytes)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Minimal IHDR chunk
  const ihdr = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x0d, // length
    0x49,
    0x48,
    0x44,
    0x52, // IHDR
    0x00,
    0x00,
    0x00,
    0x01, // width: 1
    0x00,
    0x00,
    0x00,
    0x01, // height: 1
    0x08,
    0x02, // bit depth: 8, color type: 2 (RGB)
    0x00,
    0x00,
    0x00, // compression, filter, interlace
    0x90,
    0x77,
    0x53,
    0xde, // CRC
  ]);
  // Minimal IDAT chunk
  const idat = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x0c, // length
    0x49,
    0x44,
    0x41,
    0x54, // IDAT
    0x08,
    0xd7,
    0x63,
    0xf8,
    0xcf,
    0xc0,
    0x00,
    0x00,
    0x00,
    0x05,
    0x00,
    0x03,
    0x7f,
    0x93,
    0x69,
    0x01, // CRC
  ]);
  // IEND chunk
  const iend = Buffer.from([
    0x00,
    0x00,
    0x00,
    0x00, // length
    0x49,
    0x45,
    0x4e,
    0x44, // IEND
    0xae,
    0x42,
    0x60,
    0x82, // CRC
  ]);

  return Buffer.concat([pngHeader, ihdr, idat, iend]);
}

export function createMockConfigFile(dir: string, filename: string, config: Record<string, any>): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  return filePath;
}
