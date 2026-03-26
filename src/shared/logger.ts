import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

const level = process.env.LOG_LEVEL?.trim()?.toLowerCase() || 'info';

const usePretty =
  process.env.LOG_PRETTY === '1' ||
  process.env.LOG_PRETTY?.trim()?.toLowerCase() === 'true';

/** Absolute or relative path; JSON lines appended (NDJSON). Stdout unchanged. */
const logFile = process.env.LOG_FILE?.trim();

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(path.resolve(filePath));
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Root application logger.
 * - Default: stdout only (JSON, or pretty if LOG_PRETTY=1).
 * - If LOG_FILE is set: same lines also appended to that file as JSON (pretty only on stdout).
 */
export const logger: pino.Logger = (() => {
  if (!logFile) {
    if (usePretty) {
      return pino({
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      });
    }
    return pino({ level });
  }

  ensureParentDir(logFile);

  if (usePretty) {
    return pino({
      level,
      transport: {
        targets: [
          {
            target: 'pino-pretty',
            level,
            options: { colorize: true },
          },
          {
            target: 'pino/file',
            level,
            options: { destination: path.resolve(logFile) },
          },
        ],
      },
    });
  }

  const fileDest = pino.destination({
    dest: path.resolve(logFile),
    sync: false,
  });

  return pino(
    { level },
    pino.multistream([
      { level: level as pino.Level, stream: process.stdout },
      { level: level as pino.Level, stream: fileDest },
    ]),
  );
})();
