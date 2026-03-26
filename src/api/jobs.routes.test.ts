import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  jobsRenderBodySchema,
  jobsRenderFromVideoBodySchema,
} from './jobs.routes.js';
import { scriptSceneSchema } from '../types/script-schema.js';

describe('jobsRenderBodySchema', () => {
  it('accepts preset scenes + profileId + tuning (no idea)', () => {
    const r = jobsRenderBodySchema.safeParse({
      jobId: 'test-e2e-1',
      profileId: 'cinematic_mystery',
      tuning: { ass: { fontSize: 64 } },
      scenes: [
        {
          id: 1,
          text: 'Hello cinematic',
          motion: 'static',
        },
      ],
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.profileId, 'cinematic_mystery');
      assert.equal((r.data.tuning as { ass?: { fontSize?: number } }).ass?.fontSize, 64);
    }
  });

  it('rejects when neither idea nor scenes', () => {
    const r = jobsRenderBodySchema.safeParse({ jobId: 'x' });
    assert.equal(r.success, false);
  });

  it('accepts idea-only body', () => {
    const r = jobsRenderBodySchema.safeParse({
      jobId: 'j1',
      idea: 'Một video ngắn về não bộ',
    });
    assert.equal(r.success, true);
  });

  it('accepts resumeFrom tts without idea or scenes', () => {
    const r = jobsRenderBodySchema.safeParse({
      jobId: 'existing-job',
      resumeFrom: 'tts',
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.resumeFrom, 'tts');
  });
});

describe('jobsRenderFromVideoBodySchema', () => {
  it('accepts assembleOnly + reuseRawVideo flags', () => {
    const r = jobsRenderFromVideoBodySchema.safeParse({
      jobId: 'reuse-job-1',
      reuseRawVideo: false,
      assembleOnly: false,
    });
    assert.equal(r.success, true);
  });

  it('accepts assembleOnly without voice-related fields', () => {
    const r = jobsRenderFromVideoBodySchema.safeParse({
      jobId: 'assemble-1',
      assembleOnly: true,
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.assembleOnly, true);
  });
});

describe('scriptSceneSchema', () => {
  it('treats empty optional strings as omitted (OpenAI quirk)', () => {
    const r = scriptSceneSchema.safeParse({
      id: 1,
      text: 'Câu một',
      motion: 'static',
      videoPath: '',
      videoMode: '',
      sfxKey: '',
      captionText: '',
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.videoPath, undefined);
      assert.equal(r.data.videoMode, undefined);
      assert.equal(r.data.sfxKey, undefined);
      assert.equal(r.data.captionText, undefined);
    }
  });

  it('accepts motion + emphasisWords', () => {
    const r = scriptSceneSchema.safeParse({
      id: 2,
      text: 'Câu hai với SỰ THẬT',
      motion: 'laugh_zoom',
      emphasisWords: ['SỰ THẬT'],
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.deepEqual(r.data.emphasisWords, ['SỰ THẬT']);
    }
  });
});

