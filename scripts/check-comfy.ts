/**
 * Kiểm tra ComfyUI đang listen tại COMFY_HTTP_URL (mặc định http://127.0.0.1:8188).
 */
import path from 'node:path';
import 'dotenv/config';

function comfyBaseUrl(): string {
  const v = process.env.COMFY_HTTP_URL?.trim();
  return (v || 'http://127.0.0.1:8188').replace(/\/$/, '');
}

function argvInputDirectory(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a === '--input-directory' && argv[i + 1]) {
      return path.resolve(argv[i + 1]!);
    }
    if (a.startsWith('--input-directory=')) {
      return path.resolve(a.slice('--input-directory='.length));
    }
  }
  return null;
}

function warnIfComfyInputDiffersFromEnv(argv: string[]): void {
  const envIn = process.env.COMFY_INPUT_DIR?.trim();
  if (!envIn) return;
  const resolvedEnv = path.resolve(envIn);
  const fromArgv = argvInputDirectory(argv);
  if (fromArgv) {
    if (path.resolve(fromArgv) !== resolvedEnv) {
      console.warn(
        `⚠ COMFY_INPUT_DIR (${resolvedEnv}) khác --input-directory của Comfy (${fromArgv}). ` +
          `POST /prompt thường báo Invalid … file.`,
      );
    }
    return;
  }
  console.warn(
    `⚠ Comfy đang chạy không có --input-directory → dùng …/ComfyUI/input cạnh main.py.\n` +
      `  Bạn đặt COMFY_INPUT_DIR=${resolvedEnv}. Hai đường dẫn phải trùng nhau.\n` +
      `  Cách 1: sửa .env → COMFY_INPUT_DIR=/đường/tới/ComfyUI/input (và COMFY_OUTPUT_DIR=…/output).\n` +
      `  Cách 2: chạy Comfy với --input-directory "${resolvedEnv}" và --output-directory trùng COMFY_OUTPUT_DIR.`,
  );
}

async function main(): Promise<void> {
  const base = comfyBaseUrl();
  console.log(`Checking ComfyUI at ${base} …`);

  const timeout = 5000;
  try {
    const stats = await fetch(`${base}/system_stats`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (stats.ok) {
      const j = (await stats.json()) as { system?: { argv?: string[] } };
      warnIfComfyInputDiffersFromEnv(j.system?.argv ?? []);
      console.log('ComfyUI OK (GET /system_stats).');
      return;
    }

    const root = await fetch(`${base}/`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (root.ok) {
      console.log('ComfyUI OK (GET /).');
      return;
    }

    console.error(`ComfyUI responded ${stats.status} (system_stats), ${root.status} (/) — expected 200.`);
    process.exitCode = 1;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const cause = err.cause instanceof Error ? err.cause.message : '';
    const msg = [err.message, cause].filter(Boolean).join(' — ');
    console.error(`ComfyUI not reachable: ${msg}`);
    console.error('Start ComfyUI native (see docs/comfy-macos.md) or fix COMFY_HTTP_URL.');
    if (msg.includes('ECONNREFUSED')) {
      console.error('Nothing is accepting connections on that host:port.');
    }
    process.exitCode = 1;
  }
}

void main();
