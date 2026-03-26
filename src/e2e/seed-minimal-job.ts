/**
 * Seed DATA_ROOT/jobs/{jobId} for POST /jobs/render/from-video (no OpenAI/ElevenLabs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPathProvider } from '../shared/path-provider.js';
import { runFfmpeg } from '../shared/ffmpeg-run.js';
import { generateSineMp3 } from '../services/video.service.js';
import type { JobMeta } from '../types/job-meta.js';
import type { CharacterAlignment } from '../types/elevenlabs.js';
import type { ScriptScene } from '../types/script-schema.js';

export const e2eRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export function buildLinearAlignment(
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

async function concatMp3Files(inputs: string[], outPath: string): Promise<void> {
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

/** Copy bundled cinematic preset so resolveRenderConfig works in a temp DATA_ROOT. */
export async function copyDefaultProfile(
  dataRoot: string,
  repoRoot = e2eRepoRoot,
): Promise<void> {
  const src = path.join(repoRoot, 'shared_data', 'profiles', 'cinematic_mystery.json');
  const destDir = path.join(dataRoot, 'profiles');
  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.promises.copyFile(
    src,
    path.join(destDir, 'cinematic_mystery.json'),
  );
}

/** Skip copy if preset already present (e.g. external E2E_DATA_ROOT points at dev shared_data). */
export async function ensureCinematicProfile(
  dataRoot: string,
  repoRoot = e2eRepoRoot,
): Promise<void> {
  const dest = path.join(dataRoot, 'profiles', 'cinematic_mystery.json');
  if (fs.existsSync(dest)) return;
  await copyDefaultProfile(dataRoot, repoRoot);
}

export type SeedMinimalJobOptions = {
  dataRoot: string;
  jobId: string;
  repoRoot?: string;
  /** Default 2 */
  sceneCount?: number;
  /** Seconds per scene (sine MP3). Default 2 */
  sceneSec?: number;
};

/**
 * Writes meta.json, audio/scene-*.mp3, alignments, and voice.mp3 under the job.
 */
export async function seedMinimalFromVideoJob(
  opts: SeedMinimalJobOptions,
): Promise<void> {
  const {
    dataRoot,
    jobId,
    repoRoot = e2eRepoRoot,
    sceneCount = 2,
    sceneSec = 2,
  } = opts;

  await copyDefaultProfile(dataRoot, repoRoot);

  const provider = createPathProvider(dataRoot);
  const paths = provider.jobPaths(jobId);
  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  await fs.promises.mkdir(paths.audioDir, { recursive: true });

  const scenes: ScriptScene[] = [];
  for (let i = 1; i <= sceneCount; i++) {
    scenes.push({
      id: i,
      text: `E2E scene ${i} synthetic audio.`,
      motion: i === 1 ? 'static' : 'zoom_mild',
    });
  }

  const sceneMp3Paths: string[] = [];
  for (const scene of scenes) {
    const mp3 = paths.sceneVoiceMp3(scene.id);
    const freq = 420 + scene.id * 30;
    await generateSineMp3(mp3, sceneSec, freq);
    sceneMp3Paths.push(mp3);

    const alignment = buildLinearAlignment(scene.text, sceneSec);
    await fs.promises.writeFile(
      paths.sceneAlignmentJson(scene.id),
      JSON.stringify({ alignment }, null, 2),
      'utf8',
    );
  }

  await concatMp3Files(sceneMp3Paths, paths.audioVoice);

  const totalEstimate = sceneCount * sceneSec;
  const meta: JobMeta = {
    jobId,
    profileId: 'cinematic_mystery',
    idea: 'e2e seed (no API)',
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
}
