import fs from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';

function firstExisting(paths: string[]): string | undefined {
  for (const p of paths) {
    if (p === 'ffmpeg') return p;
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const ffmpegBin =
  process.env.FFMPEG_PATH ??
  firstExisting(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']);

const ffprobeBin =
  process.env.FFPROBE_PATH ??
  firstExisting(['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', 'ffprobe']);

if (ffmpegBin) ffmpeg.setFfmpegPath(ffmpegBin);
if (ffprobeBin) ffmpeg.setFfprobePath(ffprobeBin);
