/**
 * Local smoke: mock ElevenLabs alignment + sine MP3 + black 1080x1920 base video → final mp4 with word ASS.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPathProvider } from '../src/shared/path-provider.js';
import {
  assembleFinalVideo,
  generateColorBarsVideo,
  generateSineMp3,
} from '../src/services/video.service.js';
import { characterAlignmentSchema } from '../src/types/elevenlabs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

process.env.DATA_ROOT =
  process.env.DATA_ROOT ?? path.join(repoRoot, 'shared_data');

async function main() {
  const jobId = process.env.SMOKE_JOB_ID ?? 'smoke-ass-001';
  const provider = createPathProvider();
  const paths = provider.jobPaths(jobId);

  const fixture = path.join(repoRoot, 'fixtures/mock-elevenlabs-alignment.json');
  const raw = JSON.parse(await fs.promises.readFile(fixture, 'utf8'));
  const alignment = characterAlignmentSchema.parse(raw);

  const audioDuration =
    Math.max(...alignment.character_end_times_seconds) + 0.05;

  await fs.promises.mkdir(paths.jobRoot, { recursive: true });
  await fs.promises.mkdir(paths.mediaDir, { recursive: true });
  await fs.promises.mkdir(paths.audioDir, { recursive: true });
  await fs.promises.mkdir(paths.finalDir, { recursive: true });

  console.log('Generating placeholder video (black 1080x1920)...');
  await generateColorBarsVideo(paths.mediaRawVideo, 1080, 1920, 60);

  console.log(`Generating sample MP3 (${audioDuration.toFixed(2)}s)...`);
  await generateSineMp3(paths.audioVoice, audioDuration, 440);

  console.log('Assembling with ASS burn-in...');
  await assembleFinalVideo({
    paths,
    rawVideoPath: paths.mediaRawVideo,
    voiceAudioPath: paths.audioVoice,
    alignment,
    actualDurationSec: audioDuration,
  });

  console.log('Done:', paths.finalOutput);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
