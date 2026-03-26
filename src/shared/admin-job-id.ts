import path from 'node:path';
import fs from 'node:fs';

/** Rejects path segments and traversal; returns null if invalid. */
export function sanitizeJobId(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 200) return null;
  if (s.includes('/') || s.includes('\\')) return null;
  if (s.includes('..')) return null;
  if (/[\x00-\x1f]/.test(s)) return null;
  return s;
}

/**
 * True if `filePath` resolves inside `dir` (after realpath). Use before sendFile.
 * Throws if `dir` cannot be resolved.
 */
export function isResolvedPathInsideDir(dir: string, filePath: string): boolean {
  const resolvedDir = fs.realpathSync(path.resolve(dir));
  if (!fs.existsSync(filePath)) return false;
  const resolvedFile = fs.realpathSync(path.resolve(filePath));
  const prefix = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
  return resolvedFile === resolvedDir || resolvedFile.startsWith(prefix);
}
