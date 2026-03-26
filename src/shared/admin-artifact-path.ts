import path from 'node:path';

/**
 * Resolves `rel` (POSIX-style, relative to job root) to an absolute path
 * only if it stays inside `jobRoot` (no `..`, no absolute).
 */
export function safeArtifactPath(jobRoot: string, rel: string): string | null {
  const r = rel.trim().replace(/\\/g, '/');
  if (!r || r.includes('\0')) return null;
  const segments = r.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..')) return null;
  const joined = path.join(jobRoot, ...segments);
  const resolvedRoot = path.resolve(jobRoot);
  const resolvedFile = path.resolve(joined);
  const prefix =
    resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(prefix)) {
    return null;
  }
  return joined;
}

export function contentTypeForArtifactRel(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lower.endsWith('.ass')) return 'text/plain; charset=utf-8';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
