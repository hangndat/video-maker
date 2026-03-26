/**
 * Multi-scene smoke: synthetic MP3 + alignment per scene → from-video pipeline (B-roll placeholder).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPathProvider } from '../src/shared/path-provider.js';
import { runFfmpeg } from '../src/shared/ffmpeg-run.js';
import { generateSineMp3 } from '../src/services/video.service.js';
import { runVideoPhaseFromExistingAssets } from '../src/services/pipeline.service.js';
import type { JobMeta } from '../src/types/job-meta.js';
import type { CharacterAlignment } from '../src/types/elevenlabs.js';
import type { SceneMotion, ScriptScene } from '../src/types/script-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

process.env.DATA_ROOT =
  process.env.DATA_ROOT ?? path.join(repoRoot, 'shared_data');
process.env.RENDER_PROFILE_ID =
  process.env.RENDER_PROFILE_ID ?? 'cinematic_mystery';

const ROTATE_MOTION: SceneMotion[] = [
  'zoom_mild',
  'pan_left',
  'static',
  'zoom_in_fast',
  'camera_shake',
];

const SNIPPETS_VI = [
  'Cảnh một — không gian cho thử nghiệm pipeline.',
  'Cảnh hai — vẫn là sóng sinh cho TTS giả lập.',
  'Cảnh ba — kiểm tra concat và alignment.',
  'Cảnh bốn — đủ để stress test nhiều đoạn.',
  'Năm. Sáu. Bảy. Giữ nhịp.',
  'Tám — còn tiếp.',
  'Chín.',
  'Mười.',
  'Mười một.',
  'Mười hai.',
  'Mười ba.',
  'Mười bốn.',
  'Mười lăm.',
  'Mười sáu — gần xong.',
  'Xong smoke multiscene.',
];

function buildLinearAlignment(
  text: string,
  durationSec: number,
): CharacterAlignment {
  const characters = [...text];
  if (characters.length === 0) {
    throw new Error('Scene text must not be empty');
  }
  const n = characters.length;
  const character_start_times_seconds: number[] = [];
  const character_end_times_seconds: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = (i / n) * durationSec;
    const end = ((i + 1) / n) * durationSec;
    character_start_times_seconds.push(start);
    character_end_times_seconds.push(end);
  }
  return {
    characters,
    character_start_times_seconds,
    character_end_times_seconds,
  };
}

function buildScenes(n: number): ScriptScene[] {
  const scenes: ScriptScene[] = [];
  for (let i = 1; i <= n; i++) {
    const text = SNIPPETS_VI[(i - 1) % SNIPPETS_VI.length]!;
    scenes.push({
      id: i,
      text,
      motion: ROTATE_MOTION[(i - 1) % ROTATE_MOTION.length]!,
    });
  }
  return scenes;
}

async function concatMp3Files(
  inputs: string[],
  outPath: string,
): Promise<void> {
  if (inputs.length === 0) throw new Error('No inputs to concat');
  const listPath = `${outPath}.concat.txt`;
  const body = inputs
    .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fs.promises.writeFile(listPath, body, 'utf8');
  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    outPath,
  ]);
  await fs.promises.unlink(listPath).catch(() => {});
}

function defaultSmokeMultisceneJobId(n: number, sceneSec: number): string {
  const secPart = String(sceneSec).replace(/\./g, 'p');
  return `smoke-multiscene-${n}x${secPart}s`;
}

async function main(): Promise<void> {
  const n = Math.max(1, Number(process.env.SMOKE_MULTISCENE_N ?? '12'));
  const sceneSec = Math.max(0.5, Number(process.env.SMOKE_MULTISCENE_SCENE_SEC ?? '5'));
  const jobId =
    process.env.SMOKE_MULTISCENE_JOB_ID ?? defaultSmokeMultisceneJobId(n, sceneSec);

  const provider = createPathProvider();
  const paths = provider.jobPaths(jobId);

  console.log(
    `smoke-multiscene jobId=${jobId} N=${n} sceneSec=${sceneSec}${process.env.SMOKE_MULTISCENE_JOB_ID ? '' : ' (derived id; set SMOKE_MULTISCENE_JOB_ID to pin a folder)'}`,
  );
  const scenes = buildScenes(n);

  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  await fs.promises.mkdir(paths.audioDir, { recursive: true });

  const sceneMp3Paths: string[] = [];
  for (const scene of scenes) {
    const mp3 = paths.sceneVoiceMp3(scene.id);
    const freq = 400 + scene.id * 18;
    await generateSineMp3(mp3, sceneSec, freq);
    sceneMp3Paths.push(mp3);

    const alignment = buildLinearAlignment(scene.text, sceneSec);
    const artifact = { alignment };
    await fs.promises.writeFile(
      paths.sceneAlignmentJson(scene.id),
      JSON.stringify(artifact, null, 2),
      'utf8',
    );
  }

  await concatMp3Files(sceneMp3Paths, paths.audioVoice);

  const totalEstimate = n * sceneSec;
  const meta: JobMeta = {
    jobId,
    profileId: 'cinematic_mystery',
    idea: 'smoke-multiscene local fixture (no OpenAI/ElevenLabs)',
    script: {
      scenes,
      duration_estimate: totalEstimate,
    },
  };
  await fs.promises.writeFile(
    paths.metaFile,
    JSON.stringify(meta, null, 2),
    'utf8',
  );

  const { finalVideoPath } = await runVideoPhaseFromExistingAssets({
    jobId,
    reuseRawVideo: false,
  });

  console.log('Done:', finalVideoPath);
  console.log(
    `Hint: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${finalVideoPath}`,
  );
  console.log(
    `Expected duration ~${totalEstimate}s (N=${n}, sceneSec=${sceneSec})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
