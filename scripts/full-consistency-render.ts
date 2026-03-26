/**
 * Một lần POST /jobs/render đầy đủ: preset scenes (không OpenAI), characterProfile từ
 * fixtures/character-profile-example.json, environment + merge cảnh, visual.chainComfyFrames.
 *
 * Yêu cầu trước khi chạy:
 *   - App: npm run dev (mặc định PORT=3000)
 *   - ComfyUI: 8188, WORKFLOW_PATH / COMFY_* như docs/comfy-macos.md
 *   - **Không** set SKIP_COMFY=1 (server đọc env lúc worker chạy)
 *   - ElevenLabs (TTS), shared_data/assets/Master_Face.png, assets/driving/*.mp4
 *
 * Usage:
 *   npm run render:consistency
 *   npm run render:consistency -- my-job-id
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function main(): Promise<void> {
  const port = process.env.PORT ?? '3000';
  const base = `http://127.0.0.1:${port}`;
  const jobIdFromArg = process.argv[2]?.trim();
  const jobId = jobIdFromArg || `consistency-full-${Date.now()}`;

  const profilePath = path.join(repoRoot, 'fixtures', 'character-profile-example.json');
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Missing ${profilePath}`);
  }
  const characterProfile: unknown = JSON.parse(
    fs.readFileSync(profilePath, 'utf8'),
  );

  const body = {
    jobId,
    scenes: [
      {
        id: 1,
        text: 'Bản tọa chạy thử pipeline đầy đủ: profile khai báo và chain frame giữa các cảnh.',
        emotion: 'default',
        environment: { set: 'studio', lighting: { key: 'soft' } },
      },
      {
        id: 2,
        text: 'Cảnh hai đổi emotion lái Comfy; ảnh nguồn lấy từ frame cuối cảnh một nếu chain bật.',
        emotion: 'laugh',
        environment: { lighting: { color: 'warm_fill' } },
      },
    ],
    characterProfile,
    environment: { global: 'indoor', lighting: { temp: 5500 } },
    visual: {
      chainComfyFrames: true,
    },
  };

  console.error(
    [
      'Điều kiện: npm run dev, Comfy 127.0.0.1:8188, SKIP_COMFY không set trên process app,',
      'ElevenLabs + Master_Face + driving clips.',
      `→ POST ${base}/jobs/render jobId=${jobId}`,
    ].join('\n'),
  );

  const res = await fetch(`${base}/jobs/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 2000)}`);
  }
  console.log(text);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
