import { execFile } from 'node:child_process';
import fs from 'node:fs';

function ffprobeBin(): string {
  return (
    process.env.FFPROBE_PATH ??
    (fs.existsSync('/opt/homebrew/bin/ffprobe')
      ? '/opt/homebrew/bin/ffprobe'
      : 'ffprobe')
  );
}

export function ffprobeDurationSec(audioOrVideoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobeBin(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioOrVideoPath,
      ],
      { maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const sec = parseFloat(String(stdout).trim());
        if (Number.isNaN(sec)) {
          reject(new Error('ffprobe: could not parse duration'));
          return;
        }
        resolve(sec);
      },
    );
  });
}
