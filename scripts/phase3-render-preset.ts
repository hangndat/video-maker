/**
 * Phase 3 — preset mặc định ~15s (fixtures/phase3-preset-scenes.json), không OpenAI.
 * Bản dài: PHASE3_FIXTURE=fixtures/phase3-preset-scenes-long.json
 * PIPELINE_LOG=1 — log các bước (hook Comfy vs emotion/FFmpeg từng cảnh).
 *
 * PHASE3_JOB_ID   — mặc định phase3-preset-<timestamp>
 * PHASE3_FIXTURE  — mặc định fixtures/phase3-preset-scenes.json
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runContentPipeline } from '../src/services/pipeline.service.js';
import { shutdownLangfuseOtel } from '../src/instrumentation.js';
import { scriptSceneSchema } from '../src/types/script-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const fixtureSchema = z.object({
  scenes: z.array(scriptSceneSchema).min(1),
});

async function main(): Promise<void> {
  const fixturePath = path.resolve(
    repoRoot,
    process.env.PHASE3_FIXTURE ?? 'fixtures/phase3-preset-scenes.json',
  );
  const jobId =
    process.env.PHASE3_JOB_ID ?? `phase3-preset-${Date.now()}`;

  const raw: unknown = JSON.parse(
    await fs.promises.readFile(fixturePath, 'utf8'),
  );
  const { scenes } = fixtureSchema.parse(raw);

  console.log(
    `phase3-render-preset jobId=${jobId} scenes=${scenes.length} fixture=${path.relative(repoRoot, fixturePath)} SKIP_COMFY=${process.env.SKIP_COMFY ?? '(unset)'}`,
  );

  const { finalVideoPath, meta } = await runContentPipeline({
    jobId,
    idea: `Phase 3 preset (${path.relative(repoRoot, fixturePath)})`,
    scenes,
  });

  console.log('Done:', finalVideoPath);
  console.log(
    `actual_duration≈${meta.script.actual_duration ?? '?'}s — verify: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${finalVideoPath}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => shutdownLangfuseOtel().catch(() => {}));
