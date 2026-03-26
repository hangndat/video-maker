import { execFile } from 'node:child_process';
import fs from 'node:fs';

function ffmpegBin(): string {
  return (
    process.env.FFMPEG_PATH ??
    (fs.existsSync('/opt/homebrew/bin/ffmpeg')
      ? '/opt/homebrew/bin/ffmpeg'
      : 'ffmpeg')
  );
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBin(), args, { maxBuffer: 32 * 1024 * 1024 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
