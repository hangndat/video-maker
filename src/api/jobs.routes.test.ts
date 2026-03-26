import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jobsRenderBodySchema } from './jobs.routes.js';
import { scriptSceneSchema } from '../types/script-schema.js';

describe('jobsRenderBodySchema', () => {
  it('accepts preset scenes + visual + characterProfile (no idea, no OpenAI)', () => {
    const r = jobsRenderBodySchema.safeParse({
      jobId: 'test-e2e-1',
      scenes: [
        {
          id: 1,
          text: 'Hello',
          emotion: 'default',
          environment: { lighting: 'soft', set: 'studio' },
        },
      ],
      visual: {
        chainComfyFrames: true,
        ipAdapterReferencePath: 'assets/Master_Face.png',
      },
      characterProfile: {
        skin: { pore_mm: 0.1 },
        camera_lens_mm: 85,
      },
      environment: { global: 'indoor' },
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.visual?.chainComfyFrames, true);
      assert.equal(r.data.characterProfile?.camera_lens_mm, 85);
    }
  });

  it('rejects when neither idea nor scenes', () => {
    const r = jobsRenderBodySchema.safeParse({ jobId: 'x' });
    assert.equal(r.success, false);
  });

  it('accepts idea-only body', () => {
    const r = jobsRenderBodySchema.safeParse({
      jobId: 'j1',
      idea: 'Một video ngắn',
    });
    assert.equal(r.success, true);
  });
});

describe('scriptSceneSchema', () => {
  it('allows optional per-scene environment', () => {
    const r = scriptSceneSchema.safeParse({
      id: 2,
      text: 'Câu hai',
      emotion: 'laugh',
      environment: { note: 'forest_green_light' },
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.deepEqual(r.data.environment, { note: 'forest_green_light' });
    }
  });
});

describe('characterProfileV1Schema', () => {
  it('parses fixtures/character-profile-example.json', async () => {
    const { characterProfileV1Schema } = await import(
      '../types/character-profile-schema.js'
    );
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const raw = JSON.parse(
      await readFile(
        join(root, 'fixtures', 'character-profile-example.json'),
        'utf8',
      ),
    );
    const r = characterProfileV1Schema.safeParse(raw);
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.schema_version, 1);
      assert.equal(r.data.subject?.code_name, 'ma_chu');
    }
  });
});

