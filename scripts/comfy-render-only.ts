/**
 * Chỉ chạy bước Comfy (workflow LivePortrait): copy master + voice + driving → queue → lưu comfy/raw.mp4.
 * Không OpenAI, không ElevenLabs, không FFmpeg cắt cảnh / phụ đề.
 *
 * Usage:
 *   npm run comfy:render -- <jobId>
 *   COMFY_ONLY_JOB_ID=<jobId> npm run comfy:render
 *
 * Driving clip: giống pipeline — theo emotion cảnh đầu trong meta.json, hoặc ghi đè:
 *   COMFY_TEST_EMOTION=laugh npm run comfy:render -- my-job
 *
 * Cần: Comfy đang chạy, .env đúng COMFY_*, job có audio/voice.mp3, assets/Master_Face.png.
 * Không đặt SKIP_COMFY=1 nếu muốn gọi Comfy thật.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveComfyDrivingSourcePath } from '../src/config/driving-videos.js';
import { createPathProvider } from '../src/shared/path-provider.js';
import { comfyService } from '../src/services/comfy.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

if (!process.env.DATA_ROOT) {
  process.env.DATA_ROOT = path.join(repoRoot, 'shared_data');
}

function jobIdFromArgv(argv: string[]): string | null {
  const args = argv.slice(2).filter((a) => !a.startsWith('-'));
  for (let i = args.length - 1; i >= 0; i--) {
    const a = args[i]!;
    if (a.endsWith('.ts') || a.endsWith('.js')) continue;
    return a;
  }
  return process.env.COMFY_ONLY_JOB_ID?.trim() || null;
}

async function main(): Promise<void> {
  const jobId = jobIdFromArgv(process.argv);
  if (!jobId) {
    console.error('Usage: npm run comfy:render -- <jobId>');
    console.error('Or: COMFY_ONLY_JOB_ID=<jobId> npm run comfy:render');
    process.exitCode = 1;
    return;
  }
  if (process.env.SKIP_COMFY === '1') {
    console.error('SKIP_COMFY=1 — Comfy sẽ không chạy. Bỏ biến này để gen thật.');
    process.exitCode = 1;
    return;
  }

  const provider = createPathProvider();
  const paths = provider.jobPaths(jobId);
  const masterFace = provider.masterFace();

  if (!fs.existsSync(paths.audioVoice)) {
    throw new Error(`Missing ${paths.audioVoice} (cần job đã có voice.mp3)`);
  }
  if (!fs.existsSync(masterFace)) {
    throw new Error(`Missing ${masterFace}`);
  }

  let drivingEmotion = process.env.COMFY_TEST_EMOTION?.trim();
  if (!drivingEmotion && fs.existsSync(paths.metaFile)) {
    const rawMeta = JSON.parse(
      await fs.promises.readFile(paths.metaFile, 'utf8'),
    ) as {
      script?: { scenes?: { id: number; emotion?: string }[] };
    };
    const sorted = [...(rawMeta.script?.scenes ?? [])].sort(
      (a, b) => a.id - b.id,
    );
    drivingEmotion = sorted[0]?.emotion ?? 'default';
  }
  if (!drivingEmotion) drivingEmotion = 'default';

  const dataRoot = path.resolve(
    process.env.DATA_ROOT?.trim() || path.join(repoRoot, 'shared_data'),
  );
  const drivingSrc = resolveComfyDrivingSourcePath(dataRoot, drivingEmotion);
  if (process.env.COMFY_DRIVING_VIDEO?.trim()) {
    console.warn(
      '⚠ COMFY_DRIVING_VIDEO đang set — bỏ qua map emotion; file lái luôn là:\n ',
      drivingSrc,
    );
  } else {
    console.log('Driving clip (Comfy input copy):', drivingSrc);
    if (drivingEmotion === 'laugh') {
      console.log(
        '  Gợi ý: laugh → laugh_mocking.mp4 (mocking / nhếch mép). Muốn “cười to” hơn, thay clip trong assets/driving/ hoặc đổi map trong src/config/driving-videos.ts.',
      );
    }
  }

  await fs.promises.mkdir(paths.comfyDir, { recursive: true });
  console.log(
    `Comfy only: jobId=${jobId} drivingEmotion=${drivingEmotion} → ${paths.comfyRawVideo}`,
  );
  await comfyService.renderVideo({
    jobId,
    masterFacePath: masterFace,
    voiceAudioPath: paths.audioVoice,
    rawVideoOutPath: paths.comfyRawVideo,
    drivingEmotion,
  });
  console.log('Done:', paths.comfyRawVideo);
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
