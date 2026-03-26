import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const e2eRepoRootForSpawn = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function waitForHealth(
  baseUrl: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = opts.attempts ?? 40;
  const delayMs = opts.delayMs ?? 150;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`);
      if (res.ok) {
        const j: unknown = await res.json().catch(() => null);
        if (j && typeof j === 'object' && 'ok' in j && (j as { ok: boolean }).ok) {
          return;
        }
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(delayMs);
  }
  throw new Error(
    `Health check failed for ${baseUrl}${lastErr ? `: ${lastErr}` : ''}`,
  );
}

export type SpawnedApp = {
  baseUrl: string;
  proc: ChildProcess;
  kill: () => Promise<void>;
};

/**
 * Starts `tsx src/app.ts` with the given env. Caller should set PORT, DATA_ROOT, LANGFUSE_TRACING_ENABLED=0.
 */
export function startAppSubprocess(
  env: NodeJS.ProcessEnv,
  repoRoot = e2eRepoRootForSpawn,
): SpawnedApp {
  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const appTs = path.join(repoRoot, 'src', 'app.ts');
  const proc = spawn(tsxBin, [appTs], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const basePort = env.PORT ?? '3000';
  const baseUrl = `http://127.0.0.1:${basePort}`;

  const chunks: { stream: 'out' | 'err'; data: string }[] = [];
  proc.stdout?.on('data', (b: Buffer) =>
    chunks.push({ stream: 'out', data: b.toString() }),
  );
  proc.stderr?.on('data', (b: Buffer) =>
    chunks.push({ stream: 'err', data: b.toString() }),
  );

  const kill = (): Promise<void> =>
    new Promise((resolve) => {
      if (!proc.pid || proc.killed) {
        resolve();
        return;
      }
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
      const t = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 4000);
      void proc.once('exit', () => clearTimeout(t));
    });

  proc.on('error', (err) => {
    const log = chunks.map((c) => c.data).join('');
    console.error('E2E app spawn error', err, log);
  });

  return { baseUrl, proc, kill };
}
