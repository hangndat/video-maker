import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { safeArtifactPath } from './admin-artifact-path.js';

describe('safeArtifactPath', () => {
  const root = path.join('/data', 'jobs', 'job-1');

  it('accepts nested file', () => {
    assert.equal(
      safeArtifactPath(root, 'audio/voice.mp3'),
      path.join(root, 'audio', 'voice.mp3'),
    );
  });

  it('rejects traversal', () => {
    assert.equal(safeArtifactPath(root, '../etc/passwd'), null);
    assert.equal(safeArtifactPath(root, 'audio/../../meta.json'), null);
  });

  it('rejects empty', () => {
    assert.equal(safeArtifactPath(root, ''), null);
    assert.equal(safeArtifactPath(root, '   '), null);
  });
});
