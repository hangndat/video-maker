import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

describe('admin API', () => {
  let app: Express;
  let dataRoot: string;
  const token = 'integration-test-admin-token';

  before(async () => {
    dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vm-admin-api-'));
    process.env.ADMIN_API_TOKEN = token;
    process.env.DATA_ROOT = dataRoot;
    await fs.mkdir(path.join(dataRoot, 'jobs', 'job-a'), { recursive: true });
    await fs.writeFile(
      path.join(dataRoot, 'jobs', 'job-a', 'meta.json'),
      JSON.stringify({ jobId: 'job-a', script: { scenes: [] } }),
    );
    await fs.mkdir(path.join(dataRoot, 'jobs', 'job-a', 'final'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'jobs', 'job-a', 'final', 'output.mp4'), Buffer.from([0, 0, 0]));
    await fs.writeFile(
      path.join(dataRoot, 'jobs-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: '2025-01-01T00:01:00.000Z',
        jobs: {
          'job-a': {
            jobId: 'job-a',
            status: 'completed',
            pipeline: 'content',
            profileId: 'demo',
            startedAt: '2025-01-01T00:00:00.000Z',
            completedAt: '2025-01-01T00:01:00.000Z',
            updatedAt: '2025-01-01T00:01:00.000Z',
          },
          'job-manifest-only': {
            jobId: 'job-manifest-only',
            status: 'failed',
            pipeline: 'content',
            startedAt: '2025-01-02T00:00:00.000Z',
            completedAt: '2025-01-02T00:00:01.000Z',
            updatedAt: '2025-01-02T00:00:01.000Z',
            lastError: 'dry run',
          },
        },
      }),
    );
    await fs.mkdir(path.join(dataRoot, 'profiles'), { recursive: true });
    await fs.writeFile(path.join(dataRoot, 'profiles', 'demo.json'), '{}');
    const { createApp } = await import('../create-app.js');
    app = createApp();
  });

  after(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true });
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.DATA_ROOT;
  });

  it('returns 401 without Bearer token', async () => {
    const res = await request(app).get('/admin/api/jobs');
    assert.equal(res.status, 401);
  });

  it('returns 401 with wrong token', async () => {
    const res = await request(app)
      .get('/admin/api/jobs')
      .set('Authorization', 'Bearer wrong');
    assert.equal(res.status, 401);
  });

  it('lists jobs with valid token', async () => {
    const res = await request(app)
      .get('/admin/api/jobs')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const jobs = res.body.jobs as {
      jobId: string;
      hasMeta?: boolean;
      manifestStatus?: string;
      pipeline?: string;
      profileId?: string;
    }[];
    const row = jobs.find((j) => j.jobId === 'job-a');
    assert.ok(row);
    assert.equal(row!.manifestStatus, 'completed');
    assert.equal(row!.pipeline, 'content');
    assert.equal(row!.profileId, 'demo');
    const orphan = jobs.find((j) => j.jobId === 'job-manifest-only');
    assert.ok(orphan);
    assert.equal(orphan!.manifestStatus, 'failed');
    assert.equal(orphan!.hasMeta ?? false, false);
  });

  it('returns meta for job-a', async () => {
    const res = await request(app)
      .get('/admin/api/jobs/job-a/meta')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal((res.body.meta as { jobId: string }).jobId, 'job-a');
  });

  it('rejects invalid jobId for meta', async () => {
    const res = await request(app)
      .get('/admin/api/jobs/foo%2fbar/meta')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 400);
  });

  it('lists profiles', async () => {
    const res = await request(app)
      .get('/admin/api/profiles')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.profiles, sorted(['demo']));
  });

  it('lists job artifacts', async () => {
    const res = await request(app)
      .get('/admin/api/jobs/job-a/artifacts')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const files = res.body.files as { rel: string; size: number }[];
    assert.ok(files.some((f) => f.rel === 'meta.json'));
    assert.ok(files.some((f) => f.rel === 'final/output.mp4'));
  });

  it('serves artifact file by rel', async () => {
    const res = await request(app)
      .get('/admin/api/jobs/job-a/artifacts/file')
      .query({ rel: 'meta.json' })
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    const meta = JSON.parse(res.text) as { jobId: string };
    assert.equal(meta.jobId, 'job-a');
  });

  it('rejects artifact path traversal', async () => {
    const res = await request(app)
      .get('/admin/api/jobs/job-a/artifacts/file')
      .query({ rel: '../../.env' })
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 400);
  });

  it('serves final mp4', async () => {
    const res = await request(app)
      .get('/admin/api/jobs/job-a/artifacts/final')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type']?.includes('video/mp4'), true);
  });
});

function sorted<T extends string>(arr: T[]): T[] {
  return [...arr].sort();
}
