/**
 * Smoke: extractLastFramePng — không gọi OpenAI/ElevenLabs/Comfy.
 * Tạo MP4 test 1s bằng ffmpeg rồi trích frame cuối ra PNG.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractLastFramePng } from '../src/services/video.service.js';
import { runFfmpeg } from '../src/shared/ffmpeg-run.js';

async function main(): Promise<void> {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ma-chu-smoke-chain-'));
  const mp4 = path.join(tmp, 'one-sec.mp4');
  const png = path.join(tmp, 'last.png');

  await runFfmpeg([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x240:r=30',
    '-t',
    '1',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    mp4,
  ]);

  await extractLastFramePng(mp4, png);
  const st = await fs.promises.stat(png);
  if (st.size < 200) {
    throw new Error(`PNG too small (${st.size} bytes)`);
  }
  console.log('smoke:chain ok', png, `${st.size} bytes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
