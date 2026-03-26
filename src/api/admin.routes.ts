import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPathProvider } from '../shared/path-provider.js';
import {
  isResolvedPathInsideDir,
  sanitizeJobId,
} from '../shared/admin-job-id.js';
import { readJobsManifest } from '../shared/jobs-manifest.js';
import {
  contentTypeForArtifactRel,
  safeArtifactPath,
} from '../shared/admin-artifact-path.js';

export const adminRouter = Router();

function provider() {
  return createPathProvider();
}

adminRouter.get('/context', (_req, res) => {
  const p = provider();
  res.json({
    ok: true,
    dataRoot: path.resolve(p.dataRoot),
  });
});

adminRouter.get('/jobs', async (_req, res) => {
  const p = provider();
  const manifest = await readJobsManifest(p.dataRoot);
  const root = p.jobsRoot();
  let names: string[] = [];
  try {
    names = await fs.readdir(root, { withFileTypes: true }).then((ents) =>
      ents.filter((e) => e.isDirectory()).map((e) => e.name),
    );
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw e;
  }

  const idSet = new Set([...names, ...Object.keys(manifest.jobs)]);

  const jobs = await Promise.all(
    [...idSet].map(async (jobId) => {
      if (!sanitizeJobId(jobId)) return null;
      const jp = p.jobPaths(jobId);
      let metaMtime: number | undefined;
      let hasMeta = false;
      try {
        const st = await fs.stat(jp.metaFile);
        hasMeta = true;
        metaMtime = st.mtimeMs;
      } catch {
        /* missing */
      }
      let hasFinal = false;
      try {
        await fs.access(jp.finalOutput);
        hasFinal = true;
      } catch {
        /* missing */
      }
      const m = manifest.jobs[jobId];
      return {
        jobId,
        hasMeta,
        hasFinal,
        metaMtime,
        manifestStatus: m?.status,
        pipeline: m?.pipeline,
        manifestUpdatedAt: m?.updatedAt,
        startedAt: m?.startedAt,
        completedAt: m?.completedAt,
        ideaPreview: m?.ideaPreview,
        profileId: m?.profileId,
        lastError: m?.lastError,
      };
    }),
  );

  const filtered = jobs.filter(Boolean) as NonNullable<(typeof jobs)[number]>[];
  filtered.sort((a, b) => {
    const sa = Math.max(
      a.metaMtime ?? 0,
      a.manifestUpdatedAt ? Date.parse(a.manifestUpdatedAt) || 0 : 0,
    );
    const sb = Math.max(
      b.metaMtime ?? 0,
      b.manifestUpdatedAt ? Date.parse(b.manifestUpdatedAt) || 0 : 0,
    );
    return sb - sa;
  });
  res.json({ ok: true, jobs: filtered });
});

async function walkJobArtifactFiles(
  dir: string,
  prefix: string,
  out: { rel: string; size: number }[],
): Promise<void> {
  const ents = await fs.readdir(dir, { withFileTypes: true });
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walkJobArtifactFiles(full, rel, out);
    } else {
      const st = await fs.stat(full);
      out.push({ rel, size: st.size });
    }
  }
}

adminRouter.get('/jobs/:jobId/artifacts', async (req, res) => {
  const jobId = sanitizeJobId(req.params.jobId ?? '');
  if (!jobId) {
    res.status(400).json({ ok: false, error: 'Invalid jobId' });
    return;
  }
  const p = provider();
  const jp = p.jobPaths(jobId);
  try {
    await fs.access(jp.jobRoot);
  } catch {
    res.status(404).json({ ok: false, error: 'Job folder not found' });
    return;
  }
  const files: { rel: string; size: number; contentType: string }[] = [];
  await walkJobArtifactFiles(jp.jobRoot, '', files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  res.json({
    ok: true,
    files: files.map((f) => ({
      ...f,
      contentType: contentTypeForArtifactRel(f.rel),
    })),
  });
});

adminRouter.get('/jobs/:jobId/artifacts/file', async (req, res) => {
  const jobId = sanitizeJobId(req.params.jobId ?? '');
  if (!jobId) {
    res.status(400).json({ ok: false, error: 'Invalid jobId' });
    return;
  }
  const relRaw = req.query.rel;
  const rel = typeof relRaw === 'string' ? relRaw : '';
  if (!rel.trim()) {
    res.status(400).json({ ok: false, error: 'Missing rel query' });
    return;
  }
  const p = provider();
  const jp = p.jobPaths(jobId);
  const abs = safeArtifactPath(jp.jobRoot, rel);
  if (!abs) {
    res.status(400).json({ ok: false, error: 'Invalid rel path' });
    return;
  }
  try {
    await fs.access(abs);
  } catch {
    res.status(404).json({ ok: false, error: 'File not found' });
    return;
  }
  if (!isResolvedPathInsideDir(jp.jobRoot, abs)) {
    res.status(400).json({ ok: false, error: 'Path escapes job root' });
    return;
  }
  res.type(contentTypeForArtifactRel(rel));
  res.sendFile(path.resolve(abs));
});

adminRouter.get('/jobs/:jobId/meta', async (req, res) => {
  const jobId = sanitizeJobId(req.params.jobId ?? '');
  if (!jobId) {
    res.status(400).json({ ok: false, error: 'Invalid jobId' });
    return;
  }
  const p = provider();
  const jp = p.jobPaths(jobId);
  try {
    const raw = await fs.readFile(jp.metaFile, 'utf8');
    const meta = JSON.parse(raw) as unknown;
    res.json({ ok: true, meta });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.status(404).json({ ok: false, error: 'Meta not found' });
      return;
    }
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

adminRouter.get('/profiles', async (_req, res) => {
  const p = provider();
  const root = p.profilesRoot();
  let files: string[];
  try {
    files = await fs.readdir(root);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      res.json({ ok: true, profiles: [] });
      return;
    }
    throw e;
  }
  const profiles = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/i, ''))
    .sort();
  res.json({ ok: true, profiles });
});

adminRouter.get('/jobs/:jobId/artifacts/final', async (req, res) => {
  const jobId = sanitizeJobId(req.params.jobId ?? '');
  if (!jobId) {
    res.status(400).json({ ok: false, error: 'Invalid jobId' });
    return;
  }
  const p = provider();
  const jp = p.jobPaths(jobId);
  try {
    await fs.access(jp.finalOutput);
  } catch {
    res.status(404).json({ ok: false, error: 'Final video not found' });
    return;
  }
  res.type('video/mp4');
  res.sendFile(path.resolve(jp.finalOutput));
});
