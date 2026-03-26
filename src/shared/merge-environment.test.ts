import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeEnvironmentContext } from './merge-environment.js';

describe('mergeEnvironmentContext', () => {
  it('merges top-level keys with scene overriding job', () => {
    const m = mergeEnvironmentContext(
      { global: 'indoor', set: 'studio' },
      { set: 'forest' },
    );
    assert.deepEqual(m, { global: 'indoor', set: 'forest' });
  });

  it('deep-merges one level for nested objects', () => {
    const m = mergeEnvironmentContext(
      { lighting: { key: 'soft', temp: 5500 } },
      { lighting: { color: 'green_spill' } },
    );
    assert.deepEqual(m, {
      lighting: { key: 'soft', temp: 5500, color: 'green_spill' },
    });
  });

  it('scene value replaces job when not both plain objects', () => {
    const m = mergeEnvironmentContext(
      { lighting: { key: 'soft' } },
      { lighting: 'hard_side' },
    );
    assert.deepEqual(m, { lighting: 'hard_side' });
  });
});
