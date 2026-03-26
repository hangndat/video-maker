# Pipeline chi tiết — đa cảnh, driving, reuse

Tài liệu này bổ sung [README.md](../README.md): luồng dữ liệu, `emotion`, map **driving** cho Comfy, FFmpeg từng cảnh, file artifact, API reuse và cách test.

---

## 1. Luồng tổng thể (full `POST /jobs/render`)

| Bước | Thành phần | Đầu vào | Đầu ra / ghi chú |
|------|------------|---------|------------------|
| 1 | **OpenAI** (tuỳ chọn) | `idea` **hoặc** body `scenes` sẵn | `meta.json` → `script.scenes[]` (`id`, `text`, `emotion`). Nếu gửi `scenes` → **bỏ** bước OpenAI. |
| 2 | **ElevenLabs** | Toàn bộ text nối (`scriptScenesFullText`) | `audio/voice.mp3` — **không** còn là input lip-sync chính; dùng cho `meta.voice`, `actual_duration`, và **bắt buộc** tồn tại khi `POST /jobs/render/from-video`. |
| 3 | **ElevenLabs** (lặp) | `text` từng cảnh | `audio/scene-{id}.mp3` + `scene-{id}.alignment.json` (ASS + timeline + bước Comfy) |
| 4 | **ComfyUI** × **N** | Mỗi lần: `scene-{id}.mp3`, ảnh nguồn (mặc định `Master_Face`; tuỳ chọn **chain** frame cuối cảnh trước), driving mp4 theo **`emotion`**, tuỳ chọn ảnh IP-Adapter | `comfy/scenes/raw-scene-{id}.mp4`. Đồng thời copy cảnh đầu → `comfy/raw.mp4` (mirror / legacy). |
| 5 | **FFmpeg** | `raw-scene-{id}.mp4` (hoặc fallback `raw.mp4` nếu thiếu file per-scene) + `scene-{id}.mp3` + `emotion` | `comfy/scenes/clip-{id}.mp4` (loop + motion) |
| 6 | **FFmpeg concat** | Danh sách `clip-*.mp4` | `comfy/scenes/concat.mp4` |
| 7 | **FFmpeg** | `concat.mp4` + alignment gộp | `subtitles/burn.ass` burn-in + tuỳ chọn BGM → `final/output.mp4` |

**Chi phí API:** 1 lần OpenAI (nếu có `idea`) + **1 + N** lần ElevenLabs `with-timestamps` (N = số cảnh). **Comfy:** N lần render (queue trong app `concurrency: 1`).

---

## 2. Kịch bản (`meta.json` → `script.scenes`)

Mỗi phần tử:

```json
{
  "id": 1,
  "text": "…",
  "emotion": "laugh",
  "environment": { "set": "studio", "light": "soft_key" }
}
```

(`environment` tuỳ chọn — JSON mở, lưu trong `meta.json`; chưa map tự động vào Comfy.)

- **`id`**: số nguyên dương, tăng dần; pipeline **sort theo `id`** trước khi xử lý.
- **`text`**: thoại từng cảnh (Tiếng Việt trong prompt Ma Chủ). Prompt Ma Chủ ([`src/services/script.service.ts`](../src/services/script.service.ts)) mặc định gợi ý 2–4 cảnh ngắn; khi **idea** yêu cầu video dài (~55–65s) hoặc nhiều phân cảnh → 10–16 cảnh, 2–4 câu/cảnh (kèm hướng dẫn emoji trong text — xem §6b).
- **`emotion`**: xem mục 3 và 4.
- **`environment`** (optional): ghi chú môi trường theo cảnh — xem §11 (tách khỏi nhân vật).

---

## 3. `emotion` — hai vai trò khác nhau

### 3.1. Comfy / LivePortrait — **từng cảnh**

Mỗi cảnh chạy **một** job Comfy (sub-prompt `jobId` = `{jobId}-s{sceneId}`). Audio lip-sync = **`audio/scene-{id}.mp3`** của đúng cảnh. Clip lái (driving) được chọn từ **`emotion` của đúng cảnh đó** (không còn “chỉ hook cảnh đầu”).

| `emotion` (script) | Tag driving nội bộ | File trong `DATA_ROOT/assets/driving/` |
|--------------------|--------------------|----------------------------------------|
| `laugh` | `laugh` | `laugh_mocking.mp4` |
| `angry` | `angry` | `angry_power.mp4` |
| `confused` | `confused` | `confused_ngo.mp4` |
| `thinking` | `thinking` | `deep_thinking.mp4` |
| `default` | `default` | `default_arrogant.mp4` |

**Legacy** (job / prompt cũ) — map sang tag driving giống trước:

| `emotion` | Driving tương đương |
|-----------|---------------------|
| `zoom_in_fast` | `default` |
| `pan_left` | `confused` |
| `camera_shake` | `angry` |

Nguồn bảng map trong code: [`src/config/driving-videos.ts`](../src/config/driving-videos.ts) (`DRIVING_VIDEOS`, `drivingTagFromSceneEmotion`).

**Ghi đè:** nếu set **`COMFY_DRIVING_VIDEO`** (đường dẫn tuyệt đối tới `.mp4`), **mọi** lần Comfy dùng file đó — bỏ map theo `emotion` (hữu ích debug).

**Fallback file:** nếu map không trỏ tới file tồn tại, app thử `DATA_ROOT/assets/driving_reference.mp4` (hoặc báo lỗi thiếu file tùy nhánh).

**Workflow Comfy:** driving copy vào `input` với tên `{subJobId}_driving.mp4`; audio `{subJobId}_voice.mp3` từ `scene-*.mp3`. Node **`7`** (`VHS_LoadVideoFFmpeg`) — [`src/config/comfy-workflow.ts`](../src/config/comfy-workflow.ts) (`COMFY_NODE_LOAD_DRIVING_VIDEO`).

**Script debug một lần:** `npm run comfy:render` vẫn render **chỉ** `comfy/raw.mp4` với `voice.mp3` **full** + emotion **cảnh đầu** — khác pipeline sản xuất (`raw-scene-*`).

### 3.2. FFmpeg — **từng cảnh** (sau Comfy)

Mỗi `clip-{id}.mp4` áp filter theo **`emotion` của đúng cảnh đó**. Map “mood” → kiểu chuyển động ống kính (trong [`src/services/video.service.ts`](../src/services/video.service.ts)):

| Nhóm mood / legacy | Preset FFmpeg (tóm tắt) |
|--------------------|-------------------------|
| `laugh` | Zoom vào tâm **mạnh** (`laugh_zoom`) — dễ tách với cảnh shake/pan |
| `zoom_in_fast` | Zoom vào tâm tiêu chuẩn (`zoompan`) |
| `default` | Zoom nhẹ / chậm hơn `laugh` (`zoom_mild`) — tránh trùng cảm giác “cười + zoom mạnh” |
| `confused`, `thinking`, `pan_left` | Pan trái (`crop` + `x` theo thời gian); `thinking` dùng chung nhóm pan với `confused` |
| `angry`, `camera_shake` | Rung nhẹ (`crop` + sin/cos) |

Chuỗi filter ép **`fps=30`** cuối pipeline clip để concat không lệch A/V.

---

## 4. Cấu trúc thư mục job (đầy đủ)

```
DATA_ROOT/jobs/{jobId}/
  meta.json
  declarative/
    snapshot.json                # characterProfile + environment merge theo từng cảnh (sau script resolved)
  audio/
    voice.mp3                    # TTS full — meta / from-video; không phải audio lip-sync chính trong Comfy
    scene-1.mp3 …                # TTS từng cảnh → Comfy + ASS
    scene-1.alignment.json …     # Lưu sau full render; bắt buộc cho /render/from-video
  comfy/
    raw.mp4                      # Mirror cảnh đầu (legacy / tương thích)
    scenes/
      raw-scene-{id}.mp4        # Output Comfy từng cảnh
      chain-master-{id}.png     # (tuỳ chọn) frame cuối cảnh trước → nguồn cảnh id khi bật chain
      clip-{id}.mp4
      concat.mp4
      concat.txt
  subtitles/burn.ass
  final/output.mp4
```

---

## 5. Reuse: `POST /jobs/render/from-video`

**Điều kiện:** đã có `meta.json`, `audio/voice.mp3`, mọi `audio/scene-{id}.mp3` và `scene-{id}.alignment.json` (tạo sau **một lần** full `/jobs/render` trên bản code hiện tại).

| Tham số | Ý nghĩa |
|---------|---------|
| `jobId` | Thư mục job |
| `bgmPath` | Tuỳ chọn; tương đối `DATA_ROOT` hoặc absolute |
| `reuseRawVideo`: `false` | Chạy lại Comfy (hoặc placeholder) **từng cảnh**. **Driving** theo `emotion` **từng cảnh** trong `meta.json` (trừ khi `COMFY_DRIVING_VIDEO`). |
| `reuseRawVideo`: `true` | Không gọi Comfy. Cần đủ `comfy/scenes/raw-scene-{id}.mp4` **hoặc** ít nhất `comfy/raw.mp4` (fallback: một raw cho mọi cảnh khi thiếu per-scene). |

**HTTP:** thiếu alignment → `400`; không có `meta.json` → `404`; Comfy lỗi → `502` / OOM → `503`.

**`meta.json` bổ sung (tuỳ chọn):** `characterProfile`, `environment`, `visual` được ghi khi `POST /jobs/render` gửi các field tương ứng. `from-video` **đọc lại** `meta` trên disk — `visual.chainComfyFrames`, `visual.ipAdapterReferencePath`, v.v. áp khi chạy lại Comfy với `reuseRawVideo: false` mà không cần gửi lại body (trừ khi bạn sửa tay `meta.json`).

---

## 6. Kiểm thử không tốn API

```bash
npm run verify:driving
```

- Kiểm tra file trong `assets/driving/` theo `DRIVING_VIDEOS`.
- In đường dẫn giống `resolveComfyDrivingSourcePath` (cùng logic `ComfyService`).
- Gợi ý: bỏ `COMFY_DRIVING_VIDEO` khi muốn xác nhận map emotion.

**Smoke FFmpeg + ASS (mock alignment, không ElevenLabs):** `npm run smoke:video`.

**Smoke đa cảnh (N clip + concat + ASS, không OpenAI/ElevenLabs, `SKIP_COMFY=1`):** `npm run smoke:multiscene`. Biến: `SMOKE_MULTISCENE_N`, `SMOKE_MULTISCENE_SCENE_SEC`, `DATA_ROOT`. Nếu **không** set `SMOKE_MULTISCENE_JOB_ID`, thư mục job mặc định là `smoke-multiscene-{N}x{SEC}s` (tránh ghi đè khi đổi N/SEC); muốn tên cố định thì set `SMOKE_MULTISCENE_JOB_ID`.

**Phase 3 — preset (mặc định ngắn ~15s, không OpenAI):** `npm run phase3:preset` — `fixtures/phase3-preset-scenes.json`. Bản dài cũ: `PHASE3_FIXTURE=fixtures/phase3-preset-scenes-long.json`. Debug: `PIPELINE_LOG=1`. Xem [dev-phases.md](dev-phases.md) mục Phase 3.

**Comfy sống:** `npm run check:comfy`.

**Chỉ Comfy (debug một pass):** `npm run comfy:render -- <jobId>` — một lần Comfy → `raw.mp4` với `voice.mp3` full; xem header `scripts/comfy-render-only.ts`. Pipeline đầy đủ dùng `raw-scene-*`.

**Langfuse self-host:** `npm run langfuse:env` → `docker compose -f docker-compose.langfuse.yml --env-file .env.langfuse up -d` — khóa dự án copy vào `.env` app (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`).

### 6a. E2E **không tốn token** (OpenAI / ElevenLabs API)

Ở đây nghĩa là **không gọi LLM / TTS trả phí**; Comfy chạy **local** vẫn được (chi phí máy).

| Tầng | Cách | Ghi chú |
|------|------|---------|
| 0 — Unit / parse | `npm run test` — Zod `jobsRenderBodySchema`, `characterProfileV1Schema`, `mergeEnvironment` ([`src/api/jobs.routes.test.ts`](../src/api/jobs.routes.test.ts), [`src/shared/merge-environment.test.ts`](../src/shared/merge-environment.test.ts)) | CI nhẹ, không API |
| 1 — Pipeline, không Comfy, preset | `SKIP_COMFY=1` + `scenes` từ file (`smoke:multiscene`, `phase3:preset`) — **không** gửi `idea` → không OpenAI | Có thể vẫn gọi ElevenLabs nếu chạy full TTS; muốn **zero cloud** cho bước sau assembly → dùng job đã có `audio/*` + alignment, rồi `POST /jobs/render/from-video` |
| 2 — HTTP, không OpenAI | `npm run dev`, `curl POST /jobs/render` với `jobId` + **`scenes`** (không `idea`) | Vẫn ElevenLabs nếu không stub |
| 3 — Comfy thật, không API token | Giống §7: preset `scenes`, so sánh `raw-scene-*` với `visual.chainComfyFrames` hoặc `COMFY_CHAIN_FRAMES=1` bật/tắt | Cần Comfy + `Master_Face` |

**Chuỗi frame (logic FFmpeg):** `npm run smoke:chain` — tạo MP4 test ngắn, gọi `extractLastFramePng`, không API.

**Pipeline đầy đủ + consistency (preset, không OpenAI):** terminal 1 `npm run dev` (Comfy bật, **`SKIP_COMFY` không set**), terminal 2 `npm run render:consistency` — gửi 2 cảnh + `characterProfile` từ [`fixtures/character-profile-example.json`](../fixtures/character-profile-example.json) + `visual.chainComfyFrames: true`. Output: `DATA_ROOT/jobs/{jobId}/final/output.mp4`, `declarative/snapshot.json`, `comfy/scenes/chain-master-*.png`. Tuỳ chọn jobId: `npm run render:consistency -- my-job-id`.

---

## 6b. Emoji (phụ đề & TTS)

| Cách | Ghi chú |
|------|---------|
| Emoji trong `text` cảnh | Đi vào ElevenLabs + alignment → chữ có thể xuất hiện trên ASS; đặt `ASS_FONT_NAME` (font hệ thống) nếu cần hiển thị ổn. TTS có thể bỏ qua hoặc đọc lạ một số ký tự. |
| Sticker / overlay lớn | **Chưa có** trong pipeline; roadmap: bước FFmpeg `overlay` hoặc asset timeline. |

---

## 7. Gợi ý E2E có driving thật

1. `SKIP_COMFY=0`, Comfy chạy, `npm run verify:driving` pass.
2. **Unset** `COMFY_DRIVING_VIDEO`.
3. `POST /jobs/render` với preset `scenes` — đổi **`emotion` cùng một `id`** (vd. cảnh 2 `laugh` ↔ `angry`) rồi so sánh **`comfy/scenes/raw-scene-{id}.mp4`** giữa hai job: motion lái LivePortrait khác khi driving khác.
4. Hoặc hai job chỉ khác cảnh 1: so sánh `raw-scene-1.mp4` (và `raw.mp4` mirror).
5. **Chain frame:** hai job cùng `scenes`, một job `visual: { "chainComfyFrames": true }` (hoặc `COMFY_CHAIN_FRAMES=1`), một job tắt — so `raw-scene-2+` và file `comfy/scenes/chain-master-*.png`.

---

## 8. Docker / `DATA_ROOT`

Trong Compose (`docker-compose.yml`), `DATA_ROOT` là `/data`, mount `./shared_data` → `/data`. App cũng set **`LOG_FILE=/data/logs/app.jsonl`** — log dòng JSON (NDJSON) chung volume với job và asset; clip driving vẫn ở `/data/assets/driving/`.

**Langfuse** (tuỳ chọn): stack riêng [`docker-compose.langfuse.yml`](../docker-compose.langfuse.yml) — trace OTEL từ OpenAI / pipeline / ElevenLabs khi có `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` và (self-host) `LANGFUSE_BASE_URL`. Xem [README — Biến môi trường](../README.md#biến-môi-trường).

---

## 9. Quan sát (Langfuse / log)

- **Langfuse:** `src/instrumentation.ts` bật `NodeSDK` + `LangfuseSpanProcessor` khi đủ khóa; `src/services/script.service.ts` dùng `observeOpenAI`; `src/services/pipeline.service.ts` và `src/services/voice.service.ts` dùng `@langfuse/tracing`. Tắt hẳn: `LANGFUSE_TRACING_ENABLED=0`.
- **Log app:** Pino (`src/shared/logger.ts`): `LOG_LEVEL`, `LOG_PRETTY`, `LOG_FILE` (Docker: file trên `DATA_ROOT`).
- **Pipeline chi tiết:** `PIPELINE_LOG=1` → `src/shared/pipeline-log.ts`.

---

## 10. Liên kết code

| Chủ đề | File |
|--------|------|
| Map driving + resolve cho Comfy | `src/config/driving-videos.ts` |
| Submit prompt, copy input, node 7, IP-Adapter (tuỳ chọn) | `src/services/comfy.service.ts` |
| Orchestration, Comfy per-scene, chain frame, alignment persist | `src/services/pipeline.service.ts` |
| OpenAI + schema `scenes` / `emotion` + Langfuse | `src/services/script.service.ts`, `src/types/script-schema.ts` |
| `meta.json` / `characterProfile`, `visual` | `src/types/job-meta.ts`, `src/types/character-profile-schema.ts` |
| Merge environment job + cảnh | `src/shared/merge-environment.ts` |
| TTS + trace / cost | `src/services/voice.service.ts` |
| OTEL Langfuse | `src/instrumentation.ts` |
| Clip / concat / ASS, `extractLastFramePng` | `src/services/video.service.ts` |
| Id node workflow, env IP-Adapter | `src/config/comfy-workflow.ts`, `workflows/workflow_api.json` |
| `POST /jobs/render` body | `src/api/jobs.routes.ts` |

---

## 11. Chiến lược nhất quán nhân vật (declarative + moat)

Tài liệu nghiệp vụ tóm tắt (đối chiếu code trong repo):

- **Profiling khai báo (declarative):** Tránh “trôi dạt khái niệm” của mô tả tự do bằng cách cố định đặc tả trong JSON. Repo hỗ trợ **`characterProfile`** và **`environment`** trên `meta.json` (và **`environment` từng cảnh** trong `script.scenes[]`) — có thể mở rộng dần (sinh trắc, lens, …) mà không ép schema sâu ngay.

**Ví dụ `characterProfile` (Ma Chủ)** — file mẫu trong repo: [`fixtures/character-profile-example.json`](../fixtures/character-profile-example.json). Dùng trực tiếp trong body `POST /jobs/render` (`characterProfile`) hoặc tham chiếu khi soạn meta:

```json
{
  "schema_version": 1,
  "subject": {
    "code_name": "ma_chu",
    "display_name": "Ma Chủ",
    "persona_notes": "Ngạo kiều, xưng Bản tọa; giọng hài hước khi bị công nghệ làm bối rối."
  },
  "biometrics": {
    "bone_structure": "Khung xương góc cạnh vừa phải; quai hàm rõ, không quá gầy.",
    "lip_fullness": "Môi trên đầy vừa, môi dưới hơi dày hơn một chút; viền môi sắc nét.",
    "skin": {
      "tone_base": "neutral_warm",
      "pore_size_mm": 0.1,
      "texture_notes": "Lỗ chân lông mịn vừa phải vùng má; không porcelain hoàn toàn.",
      "subsurface_scattering_ref": "medium — da phản chiếu ấm dưới ánh đèn key, không xỉn khi bóng đổ"
    },
    "landmarks": {
      "mole_mm_positions": [],
      "notes": "Thêm tọa độ thông thường nếu cần khóa nốt ruồi nhận diện."
    }
  },
  "camera": {
    "lens_focal_length_mm": 85,
    "sensor_equiv_notes": "Có thể dùng 100mm tương đương để giữ mép mặt ít biến dạng.",
    "framing": "bust_up",
    "anti_distortion": "tránh góc siêu rộng; ưu tiên portrait"
  },
  "wardrobe_anchor": {
    "palette_lock": ["đen", "vàng đồng nhấn"],
    "silhouette_notes": "Cổ áo kiểu cổ điển / layer cứng để nhất quán giữa các cảnh khi chain frame."
  },
  "consistency": {
    "locked_vs_scene": "character_profile locked; chỉ environment / lighting / set thay theo từng cảnh (trong meta.environment hoặc scene.environment).",
    "liveportrait_source": "Master_Face.png hoặc chain-master-*.png khi bật visual.chainComfyFrames"
  }
}
```
- **Tách nhân vật / môi trường:** Nguyên tắc: khóa đối tượng nhân vật, chỉ đổi bối cảnh — trong pipeline, ảnh nguồn LivePortrait (`Master_Face` hoặc **chain** từ frame cuối) tách khỏi clip **driving** (motion) theo từng cảnh. File **`declarative/snapshot.json`** ghi `environment_merged` = merge 1 cấp giữa `meta.environment` và `scene.environment` (cảnh ghi đè job).
- **Visual moat:** LoRA / ControlNet / IP-Adapter là lớp **workflow Comfy**. Repo mặc định: LivePortrait + `Master_Face`. **IP-Adapter:** export graph có node tham chiếu ảnh, set `COMFY_NODE_IP_ADAPTER_IMAGE` và (tuỳ chọn) `visual.ipAdapterReferencePath` hoặc `COMFY_IP_ADAPTER_REFERENCE_PATH` — xem [comfy-macos.md](comfy-macos.md).
- **Chain khung hình:** `visual.chainComfyFrames: true` hoặc **`COMFY_CHAIN_FRAMES=1`** — sau mỗi `raw-scene-{i}.mp4`, FFmpeg trích frame gần cuối → `chain-master-{i+1}.png` làm ảnh nguồn cảnh tiếp theo (giảm lệch trang phục / ánh sáng giữa các lần render tách).
- **Vật lý / camera / MAS:** Mô phỏng da, tiêu cự cố định, vòng **critic** tự sửa — có thể ghi trong `characterProfile` / `environment` để đồng bộ tài liệu sản xuất; **agent critic** tự động rewrite prompt **chưa** có trong app (quan sát: Langfuse / log, `PIPELINE_LOG=1`).
