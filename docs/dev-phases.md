# Dev theo phase — video ~60s, đa cảnh, emoji ($0 trước)

Chiến lược: tách chỉnh FFmpeg / ghép cảnh khỏi OpenAI, ElevenLabs, Comfy cho đến khi cần. Công cụ $0: `verify:driving`, `smoke:video`, `smoke:multiscene` (xem [pipeline.md](pipeline.md) mục 6).

**Cổng chuyển phase**

- Không vào Phase 2 trước khi T0.* và T1.* tối thiểu đạt (verify + smoke:video + smoke:multiscene nhỏ).
- Không vào Phase 3 trước khi Phase 2 có ít nhất một job reference thật và `POST /jobs/render/from-video` tái chạy được.

---

## Phase 0 — Môi trường & pipeline ($0)

**Việc làm:** `npm run verify:driving`, `npm run smoke:video`, đọc [pipeline.md](pipeline.md), soi cấu trúc `shared_data/jobs/<jobId>/`.

**Definition of done**

- `verify:driving` thoát mã **0**.
- `smoke:video` thoát **0**, có `final/output.mp4`.
- Liệt kê được artifact bắt buộc cho job đa cảnh (meta, audio, comfy, subtitles, final — theo pipeline).

**Kế hoạch test**

| Bước | Việc làm | Kết quả mong đợi |
|------|----------|------------------|
| T0.1 | `npm run verify:driving` | Không thiếu file driving |
| T0.2 | `npm run smoke:video` | MP4 mở được |
| T0.3 | `ffprobe` trên output smoke | `duration` > 0 |
| T0.4 | (Tuỳ chọn) `npm run check:comfy` | Health OK — không bắt buộc $0 |
| T0.5 | So cây thư mục job mẫu với pipeline.md | Đủ các nhánh |

---

## Phase 1 — Đa cảnh cục bộ ($0)

**Việc làm:** `npm run smoke:multiscene` — script [`scripts/smoke-multiscene.ts`](../scripts/smoke-multiscene.ts) sinh fixture + gọi pipeline (`SKIP_COMFY=1`).

**Env:** `SMOKE_MULTISCENE_N` (12), `SMOKE_MULTISCENE_SCENE_SEC` (5 → ~60s với N=12), `DATA_ROOT`. **`SMOKE_MULTISCENE_JOB_ID`** tuỳ chọn — nếu bỏ trống, job nằm ở `jobs/smoke-multiscene-{N}x{SEC}s/` (vd. `3x2s`, `12x5s`) để mỗi cấu hình không ghi đè lẫn nhau.

**Definition of done**

- `package.json` có `smoke:multiscene`; `npm run smoke:multiscene` exit **0**.
- Đủ artifact: `meta.json`, `audio/voice.mp3`, mọi `scene-{id}.mp3` + `.alignment.json`, `comfy/raw.mp4` placeholder, `comfy/scenes/clip-*.mp4`, `concat.mp4`, `subtitles/burn.ass`, `final/output.mp4`.
- `ffprobe` duration final ≈ **N × SCENE_SEC** (lệch nhỏ do encode).
- Không gọi OpenAI / ElevenLabs.

**Kế hoạch test**

| Bước | Việc làm | Kết quả mong đợi |
|------|----------|------------------|
| T1.1 | `SMOKE_MULTISCENE_N=3 SMOKE_MULTISCENE_SCENE_SEC=2 npm run smoke:multiscene` | 3 clip + concat |
| T1.2 | Mặc định (12×5) | ~60s output |
| T1.3 | `ffprobe` từng `scene-*.mp3` | Mỗi file ≈ SCENE_SEC |
| T1.4 | Xem sub trên player | Khớp timeline mock |
| T1.5 | Chạy lại cùng `JOB_ID` | Ghi đè ổn định |
| T1.6 | `POST /jobs/render/from-video` + `reuseRawVideo: true` | 200, không regenerate raw |

---

## Phase 2 — Smoke trả phí tối thiểu

**Việc làm:** Một lần `POST /jobs/render` với `SKIP_COMFY=1`. Dùng **`scenes`** trong body (2–3 cảnh) để **không gọi OpenAI** — chỉ tốn ElevenLabs + placeholder Comfy; hoặc `idea` ngắn nếu muốn kiểm cả prompt.

**Tuỳ chọn — quan sát:** bật Langfuse (`LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`, self-host: `docker-compose.langfuse.yml` + `npm run langfuse:env`) để xem trace OpenAI / TTS và ước lượng chi phí (`LANGFUSE_ELEVENLABS_USD_PER_1K_CHARS`).

**Definition of done**

- HTTP **200**, `meta.json` đủ scene + `scene-*.alignment.json`.
- `/jobs/render/from-video` sau đó không 400 thiếu alignment.

**Kế hoạch test**

| Bước | Việc làm | Kết quả mong đợi |
|------|----------|------------------|
| T2.1 | Full render `SKIP_COMFY=1` | 200 |
| T2.2 | So artifact với pattern Phase 1 | Cùng hình thức file |
| T2.3 | `from-video` + `reuseRawVideo: true` | 200 |
| T2.4 | `ffprobe` | ≈ tổng audio scene (ElevenLabs) |

---

## Phase 3 — Sản xuất ~60s + Comfy thật

**Việc làm:** hoặc `idea` tới OpenAI ([`script.service.ts`](../src/services/script.service.ts)), hoặc preset **không OpenAI**: [`fixtures/phase3-preset-scenes.json`](../fixtures/phase3-preset-scenes.json) (**3 cảnh ~15s**, hook **angry** để Comfy không luôn `laugh`). Bản 12 cảnh: [`fixtures/phase3-preset-scenes-long.json`](../fixtures/phase3-preset-scenes-long.json). **`PIPELINE_LOG=1`**: log đầy đủ hook vs FFmpeg từng cảnh.

**Lệnh có sẵn (tốn ElevenLabs + tùy Comfy):**

```bash
npm run check:comfy
SKIP_COMFY=0 npm run phase3:preset
# hoặc: PHASE3_JOB_ID=my-phase3 SKIP_COMFY=0 npm run phase3:preset
```

`SKIP_COMFY=1` vẫn chạy được để chỉ thử TTS + concat + ASS (placeholder raw).

**Điều kiện:** `.env` đủ `ELEVENLABS_*`; Comfy bật + `COMFY_*` khi `SKIP_COMFY=0`. `COMFY_WS_TIMEOUT_MS` đủ lớn nếu `voice.mp3` dài.

**Definition of done**

- `ffprobe` final trong ngưỡng thoại mục tiêu (vd. 55–70s — đo thực tế sau TTS).
- `comfy/raw.mp4` từ Comfy (trừ khi cố ý `SKIP_COMFY=1`).

**Kế hoạch test:** full render không 502/503; `ffprobe`; so raw khi đổi emotion hook cảnh 1; preset = **0 OpenAI**, **1 + N** ElevenLabs.

---

## Phase 4 — Emoji & polish

**Việc làm:** Xem [pipeline.md](pipeline.md) mục **6b** (emoji): emoji trong `text` + `ASS_FONT_NAME`, hoặc roadmap overlay FFmpeg.

**Definition of done**

- Quyết định ghi lại (text+font vs overlay).
- Clip thử có emoji nếu chọn đường text.

**Kế hoạch test:** render ngắn có emoji; đổi font; prototype overlay nếu có.
