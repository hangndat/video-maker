import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeJobId, isResolvedPathInsideDir } from './admin-job-id.js';

describe('sanitizeJobId', () => {
  it('accepts plain id', () => {
    assert.equal(sanitizeJobId('  my-job_1  '), 'my-job_1');
  });

  it('rejects slash and dots', () => {
    assert.equal(sanitizeJobId('a/b'), null);
    assert.equal(sanitizeJobId('..'), null);
    assert.equal(sanitizeJobId('x..y'), null);
  });

  it('rejects empty', () => {
    assert.equal(sanitizeJobId(''), null);
    assert.equal(sanitizeJobId('   '), null);
  });
});

describe('isResolvedPathInsideDir', () => {
  it('returns true for file inside dir', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-path-'));
    const sub = path.join(root, 'final');
    fs.mkdirSync(sub);
    const file = path.join(sub, 'output.mp4');
    fs.writeFileSync(file, 'x');
    assert.equal(isResolvedPathInsideDir(root, file), true);
  });

  it('returns false for path outside dir', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-path-'));
    const outside = path.join(os.tmpdir(), 'outside.mp4');
    fs.writeFileSync(outside, 'x');
    assert.equal(isResolvedPathInsideDir(root, outside), false);
  });
});
