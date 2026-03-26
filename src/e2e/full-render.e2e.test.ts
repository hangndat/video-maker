/**
 * Optional paid E2E: POST /jobs/render with scenes (ElevenLabs + ingest + FFmpeg).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { ffprobeDurationSec } from '../shared/ffprobe.js';
import { ensureCinematicProfile } from './seed-minimal-job.js';
import { startAppSubprocess, waitForHealth } from './spawn-app.js';

const missingEleven =
  !process.env.ELEVENLABS_API_KEY?.trim() ||
  !process.env.ELEVENLABS_VOICE_ID?.trim();

describe(
  'E2E POST /jobs/render (ElevenLabs)',
  { skip: missingEleven },
  () => {
    let dataRoot: string;
    let jobId: string;
    let baseUrl: string;
    let killApp: (() => Promise<void>) | undefined;

    before(async () => {
      jobId = `e2e-full-${Date.now()}`;
      const externalBase = process.env.E2E_BASE_URL?.trim();

      if (externalBase) {
        const root =
          process.env.E2E_DATA_ROOT?.trim() || process.env.DATA_ROOT?.trim();
        assert.ok(
          root,
          'E2E_BASE_URL requires E2E_DATA_ROOT or DATA_ROOT matching the server',
        );
        dataRoot = path.resolve(root);
        baseUrl = externalBase.replace(/\/$/, '');
        killApp = undefined;
      } else {
        dataRoot = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'video-maker-e2e-full-'),
        );
        const port =
          process.env.E2E_PORT?.trim() ||
          String(41000 + Math.floor(Math.random() * 10000));
        const { baseUrl: url, kill } = startAppSubprocess({
          PORT: port,
          DATA_ROOT: dataRoot,
          LANGFUSE_TRACING_ENABLED: '0',
          RENDER_PROFILE_ID: 'cinematic_mystery',
        });
        baseUrl = url;
        killApp = kill;
        await waitForHealth(baseUrl);
      }

      await ensureCinematicProfile(dataRoot);
    });

    after(async () => {
      if (killApp) await killApp();
    });

    it('renders one short scene to final/output.mp4', async () => {
      const res = await fetch(`${baseUrl}/jobs/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId,
          profileId: 'cinematic_mystery',
          scenes: [
            {
              id: 1,
              text: 'E2E short line.',
              motion: 'static',
            },
          ],
        }),
      });

      const raw = await res.text();
      assert.strictEqual(res.status, 200, raw);
      const body = JSON.parse(raw) as {
        ok?: boolean;
        finalVideoPath?: string;
        error?: string;
      };
      assert.strictEqual(body.ok, true, body.error ?? '');
      const finalPath = body.finalVideoPath;
      assert.ok(finalPath && typeof finalPath === 'string');
      assert.ok(fs.existsSync(finalPath), finalPath);

      const dur = await ffprobeDurationSec(finalPath);
      assert.ok(dur > 0, `duration ${dur}`);
    });
  },
);
