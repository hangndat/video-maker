/**
 * POST /jobs/render/from-video — không gọi lại ElevenLabs khi đã có audio/ + alignment.
 *
 * Flags:
 *   --reuse-raw     giữ media/scenes/source-*.mp4
 *   --assemble-only ASS + BGM/SFX trên concat.mp4 có sẵn
 *
 * Env: APP_URL (default http://localhost:3000)
 */
const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function usage(): never {
  console.error(`Usage: npm run render:from-video -- <jobId> [--reuse-raw] [--assemble-only]

Tuning render mà không gọi lại TTS: cần job đã chạy ít nhất một lần POST /jobs/render
(voice.mp3, scene-*.mp3, scene-*.alignment.json).

  --reuse-raw      reuseRawVideo: true
  --assemble-only  chỉ bước final trên media/scenes/concat.mp4

APP_URL=${APP_URL}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const jobId = argv.find((a) => !a.startsWith('--'));
if (!jobId?.trim()) usage();

const body: Record<string, unknown> = {
  jobId: jobId.trim(),
};
if (flags.has('--reuse-raw')) body.reuseRawVideo = true;
if (flags.has('--assemble-only')) body.assembleOnly = true;

const url = `${APP_URL}/jobs/render/from-video`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const text = await res.text();
let json: unknown;
try {
  json = JSON.parse(text);
} catch {
  json = text;
}

if (!res.ok) {
  console.error(`HTTP ${res.status}`, json);
  process.exit(1);
}

console.log(JSON.stringify(json, null, 2));
