/**
 * $0 multi-scene smoke: synthetic MP3 + alignment per scene → full pipeline via
 * runVideoPhaseFromExistingAssets (SKIP_COMFY=1 placeholder raw).
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
import type { SceneEmotion, ScriptScene } from '../src/types/script-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

process.env.DATA_ROOT =
  process.env.DATA_ROOT ?? path.join(repoRoot, 'shared_data');

const ROTATE_EMOTIONS: SceneEmotion[] = [
  'laugh',
  'angry',
  'confused',
  'thinking',
  'default',
];

const SNIPPETS_VI = [
  'Bản tọa lên sóng, trend này nhạt quá.',
  'Hả? Công nghệ lại làm Bản tọa bối rối rồi.',
  'Ma Chủ cười khẩy, các ngươi đoán sai hết rồi.',
  'Thôi được, để Bản tọa giải thích một lần cho rõ.',
  'TikTok zone này… Bản tọa thấy bất ổn quá.',
  'Suy cho cùng, trend hay do người đọc mà thôi.',
  'Bực thật, sao cứ nhảy vào mặt Bản tọa thế?',
  'Tỉnh táo nào, twist nằm ở câu cuối đấy.',
  'Các ngươi bấm like chỉ vì hình Shrek đúng không?',
  'Bản tọa không tin AI đọc được sắc mặt này.',
  'Khoan đã, điện thoại Bản tọa đang lag kìa.',
  'Kết: dù sao Bản tọa vẫn là trùm khu vực này.',
  'Một câu nữa cho đủ beat, smoke multiscene thôi.',
  'Giọng Bản tọa hay hơn filter mười lớp rồi.',
  'Xong phim, đi ngủ.',
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
      emotion: ROTATE_EMOTIONS[(i - 1) % ROTATE_EMOTIONS.length]!,
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

/** Default job folder avoids clobbering: T1.1 (3×2s) vs full (~12×5s) get different paths unless JOB_ID is set. */
function defaultSmokeMultisceneJobId(n: number, sceneSec: number): string {
  const secPart = String(sceneSec).replace(/\./g, 'p');
  return `smoke-multiscene-${n}x${secPart}s`;
}

async function main(): Promise<void> {
  const n = Math.max(1, Number(process.env.SMOKE_MULTISCENE_N ?? '12'));
  const sceneSec = Math.max(0.5, Number(process.env.SMOKE_MULTISCENE_SCENE_SEC ?? '5'));
  const jobId =
    process.env.SMOKE_MULTISCENE_JOB_ID ?? defaultSmokeMultisceneJobId(n, sceneSec);

  process.env.SKIP_COMFY = '1';

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
