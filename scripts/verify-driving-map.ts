/**
 * E2E kiểm tra map emotion → file `assets/driving/*.mp4` (cùng logic Comfy).
 * Không gọi OpenAI/Comfy. Chạy: npm run verify:driving
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DRIVING_VIDEOS,
  drivingTagFromSceneEmotion,
  resolveComfyDrivingSourcePath,
  resolveDrivingAbsolutePath,
} from '../src/config/driving-videos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataRoot = process.env.DATA_ROOT
  ? path.resolve(process.env.DATA_ROOT)
  : path.join(repoRoot, 'shared_data');

function ffprobeSize(p: string): Promise<{ duration: string; size: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.env.FFPROBE_PATH ?? 'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration,size',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        p,
      ],
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const lines = String(stdout).trim().split('\n');
        resolve({ duration: lines[0] ?? '?', size: lines[1] ?? '?' });
      },
    );
  });
}

async function main(): Promise<void> {
  console.log(`DATA_ROOT=${dataRoot}\n`);

  if (process.env.COMFY_DRIVING_VIDEO?.trim()) {
    console.warn(
      '⚠ COMFY_DRIVING_VIDEO đang set — mọi emotion sẽ trỏ cùng một file:\n',
      process.env.COMFY_DRIVING_VIDEO,
      '\n',
    );
  }

  let failed = false;

  console.log('--- Bản map DRIVING_VIDEOS (assets/driving/) ---');
  for (const tag of Object.keys(DRIVING_VIDEOS) as (keyof typeof DRIVING_VIDEOS)[]) {
    const p = resolveDrivingAbsolutePath(dataRoot, tag);
    const ok = fs.existsSync(p);
    if (!ok) failed = true;
    const line = `${tag.padEnd(10)} → ${DRIVING_VIDEOS[tag].padEnd(22)} ${ok ? 'OK' : 'THIẾU'}`;
    console.log(line);
    if (!ok) console.log(`           path: ${p}`);
  }

  const sceneEmotions = [
    'laugh',
    'angry',
    'confused',
    'thinking',
    'default',
    'zoom_in_fast',
    'pan_left',
    'camera_shake',
  ] as const;

  console.log('\n--- resolveComfyDrivingSourcePath (như Comfy hook) ---');
  for (const em of sceneEmotions) {
    let abs: string;
    try {
      abs = resolveComfyDrivingSourcePath(dataRoot, em);
    } catch (e) {
      console.error(em, '→ ERROR', e);
      failed = true;
      continue;
    }
    const tag = drivingTagFromSceneEmotion(em);
    const rel = path.relative(dataRoot, abs) || abs;
    console.log(
      `${em.padEnd(14)} → tag ${String(tag).padEnd(9)} → ${rel}`,
    );
  }

  console.log('\n--- Khác nhau thật (kích thước file giữa các mood) ---');
  const moodKeys = sceneEmotions.filter((e) =>
    ['laugh', 'angry', 'confused', 'thinking', 'default'].includes(e),
  );
  let sizes: number[] = [];
  for (const em of moodKeys) {
    const abs = resolveComfyDrivingSourcePath(dataRoot, em);
    if (!fs.existsSync(abs)) continue;
    sizes.push(fs.statSync(abs).size);
  }
  const uniqueMoodSizes = new Set(sizes);
  if (uniqueMoodSizes.size >= 4) {
    console.log(
      `OK: ít nhất 4 kích thước khác nhau giữa các mood chính (${uniqueMoodSizes.size} distinct).`,
    );
  } else if (process.env.COMFY_DRIVING_VIDEO?.trim()) {
    console.log('Bỏ qua (COMFY_DRIVING_VIDEO ghi đè).');
  } else {
    console.warn(
      '⚠ Ít biến thể size — kiểm tra lại file trong assets/driving/',
    );
  }

  for (const em of ['laugh', 'angry', 'default'] as const) {
    const abs = resolveComfyDrivingSourcePath(dataRoot, em);
    if (!fs.existsSync(abs)) continue;
    try {
      const { duration, size } = await ffprobeSize(abs);
      console.log(`ffprobe ${em}: duration=${duration}s format.size=${size}`);
    } catch {
      console.log(`ffprobe ${em}: (lỗi ffprobe, bỏ qua)`);
    }
  }

  if (failed) {
    console.error('\n✖ Có path thiếu — thêm clip vào assets/driving/ hoặc chỉnh DRIVING_VIDEOS.');
    process.exit(1);
  }
  console.log('\n✔ verify:driving xong. Để thấy motion trong raw.mp4 cần Comfy thật: SKIP_COMFY=0 và POST /jobs/render với cảnh 1 đúng emotion.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
