# Tài liệu

| Tài liệu | Mục đích |
|----------|----------|
| [README.md](../README.md) | Cài đặt, `DATA_ROOT`, bảng API (`GET /health`, `POST /jobs/...`), Docker, script npm, E2E |
| [**pipeline.md**](pipeline.md) | Bảng bước render, preset & merge (§2.1), `motion`, `segmentVideoMode`, SFX, `from-video`, file nguồn trong `src/`, §8 E2E |
| [docker-compose.langfuse.yml](../docker-compose.langfuse.yml) | Langfuse self-host; kết hợp `LANGFUSE_*` trong `.env` app (`npm run langfuse:env`) |
| [.env.example](../.env.example) | Ứng dụng: preset, OpenAI, ElevenLabs, ASS/BGM, E2E, Langfuse tuỳ chọn |
| [.env.langfuse.example](../.env.langfuse.example) | Compose Langfuse — nên dùng `npm run langfuse:env` để sinh secrets |

**Schema & code tham chiếu**

| Chủ đề | File |
|--------|------|
| Preset file + `tuning` (Zod) | [`src/types/render-preset-schema.ts`](../src/types/render-preset-schema.ts) |
| Scene / motion / `videoMode` | [`src/types/script-schema.ts`](../src/types/script-schema.ts) |
| Job meta | [`src/types/job-meta.ts`](../src/types/job-meta.ts) |

**Gợi ý đọc**

1. [README.md](../README.md) — chạy nhanh và gọi API.
2. [pipeline.md](pipeline.md) — chỉnh kênh qua JSON preset và reuse job.
3. Compose Langfuse — khi cần trace: `docker-compose.langfuse.yml` + `.env.langfuse`.
