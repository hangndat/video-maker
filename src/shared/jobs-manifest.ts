import fs from 'node:fs/promises';
import path from 'node:path';

export const JOBS_MANIFEST_FILENAME = 'jobs-manifest.json';

export type JobManifestPipeline =
  | 'content'
  | 'content_tts_resume'
  | 'from_video'
  | 'assemble_only';

export type JobManifestEntry = {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  pipeline: JobManifestPipeline;
  profileId?: string;
  ideaPreview?: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  lastError?: string;
};

export type JobsManifest = {
  schemaVersion: number;
  updatedAt: string;
  jobs: Record<string, JobManifestEntry>;
};

const MANIFEST_VERSION = 1;

export function jobsManifestPath(dataRoot: string): string {
  return path.join(dataRoot, JOBS_MANIFEST_FILENAME);
}

function emptyManifest(): JobsManifest {
  return {
    schemaVersion: MANIFEST_VERSION,
    updatedAt: new Date().toISOString(),
    jobs: {},
  };
}

export async function readJobsManifest(dataRoot: string): Promise<JobsManifest> {
  const file = jobsManifestPath(dataRoot);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyManifest();
    const o = parsed as Record<string, unknown>;
    const jobs = o.jobs;
    if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) {
      return emptyManifest();
    }
    return {
      schemaVersion:
        typeof o.schemaVersion === 'number' ? o.schemaVersion : MANIFEST_VERSION,
      updatedAt:
        typeof o.updatedAt === 'string'
          ? o.updatedAt
          : new Date().toISOString(),
      jobs: jobs as Record<string, JobManifestEntry>,
    };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return emptyManifest();
    throw e;
  }
}

async function writeJobsManifest(dataRoot: string, m: JobsManifest): Promise<void> {
  const file = jobsManifestPath(dataRoot);
  m.updatedAt = new Date().toISOString();
  await fs.mkdir(dataRoot, { recursive: true });
  const tmp = path.join(
    dataRoot,
    `.jobs-manifest.${process.pid}.${Date.now()}.tmp`,
  );
  await fs.writeFile(tmp, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

export async function notifyJobStarted(
  dataRoot: string,
  init: {
    jobId: string;
    pipeline: JobManifestPipeline;
    profileId?: string;
    ideaPreview?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const m = await readJobsManifest(dataRoot);
  m.jobs[init.jobId] = {
    jobId: init.jobId,
    status: 'running',
    pipeline: init.pipeline,
    profileId: init.profileId,
    ideaPreview: init.ideaPreview,
    startedAt: now,
    updatedAt: now,
  };
  await writeJobsManifest(dataRoot, m);
}

export async function notifyJobFinished(
  dataRoot: string,
  jobId: string,
  outcome: { ok: true; profileId?: string } | { ok: false; error: string },
): Promise<void> {
  const now = new Date().toISOString();
  const m = await readJobsManifest(dataRoot);
  const prev = m.jobs[jobId];
  const base: JobManifestEntry =
    prev ??
    ({
      jobId,
      status: 'running',
      pipeline: 'content',
      startedAt: now,
      updatedAt: now,
    } satisfies JobManifestEntry);

  if (outcome.ok) {
    m.jobs[jobId] = {
      jobId: base.jobId,
      status: 'completed',
      pipeline: base.pipeline,
      profileId: outcome.profileId ?? base.profileId,
      ideaPreview: base.ideaPreview,
      startedAt: base.startedAt,
      completedAt: now,
      updatedAt: now,
    };
  } else {
    m.jobs[jobId] = {
      ...base,
      status: 'failed',
      completedAt: now,
      updatedAt: now,
      lastError: outcome.error.slice(0, 2000),
    };
  }
  await writeJobsManifest(dataRoot, m);
}
