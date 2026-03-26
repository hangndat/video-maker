/**
 * POST /jobs/render với preset scenes — B-roll từ placeholder trong profile.
 *
 * Yêu cầu: npm run dev, ElevenLabs, preset `shared_data/profiles/cinematic_mystery.json`.
 */
import 'dotenv/config';

async function main(): Promise<void> {
  const port = process.env.PORT ?? '3000';
  const base = `http://127.0.0.1:${port}`;
  const jobIdFromArg = process.argv[2]?.trim();
  const jobId = jobIdFromArg || `consistency-full-${Date.now()}`;

  const body = {
    jobId,
    profileId: 'cinematic_mystery',
    scenes: [
      {
        id: 1,
        text: 'Bạn có chắc mình hiểu đúng về cách não xử lý sự chú ý?',
        motion: 'zoom_in_fast' as const,
      },
      {
        id: 2,
        text: 'Sự thật một: chú ý có hạn; não lọc nhiễu tốn năng lượng hơn bạn nghĩ.',
        motion: 'zoom_mild' as const,
      },
    ],
  };

  console.error(
    [`Điều kiện: npm run dev, ElevenLabs, RENDER_PROFILE_ID / preset file.`, `→ POST ${base}/jobs/render jobId=${jobId}`].join('\n'),
  );

  const res = await fetch(`${base}/jobs/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 2000)}`);
  }
  console.log(text);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
