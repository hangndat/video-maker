# Pipeline — Điện ảnh hóa kiến thức (B-roll)

Bổ sung [README.md](../README.md): luồng dữ liệu, **preset file**, artifact, reuse và test.

---

## 1. Luồng `POST /jobs/render`

| Bước | Thành phần | Đầu vào | Đầu ra |
|------|------------|---------|--------|
| 0 | **resolveRenderConfig** | `DATA_ROOT/profiles/{profileId}.json`, `job.tuning`, env | `effectiveRenderConfig` → lưu `meta.json` |
| 1 | **OpenAI** (tuỳ chọn) | `idea` **hoặc** bỏ qua nếu có `scenes` | `script.scenes[]` — với `idea`: **đúng 5** scene id 1…5 |
| 2 | **ElevenLabs** | Full text → `voice.mp3`; từng `scene.text` (đã strip `**`) → `scene-{id}.mp3` + alignment |
| 3 | **Ingest B-roll** | `scene.videoPath` hoặc `videoDefault.placeholderRelativePath` trong preset | `media/scenes/source-{id}.mp4` |
| 4 | **FFmpeg / scene** | source + `scene-{id}.mp3`, `motion`, `segmentVideoMode` | `clip-{id}.mp4` |
| 5 | **Concat** | `clip-*.mp4` | `concat.mp4` |
| 6 | **Final** | `concat.mp4` + alignment gộp | `subtitles/burn.ass` + BGM + SFX → `final/output.mp4` |

---

## 2. Preset (`profiles/*.json`)

- **Schema:** xem [`src/types/render-preset-schema.ts`](../src/types/render-preset-schema.ts).
- **Merge:** code default < env < **preset file** < `tuning` (body API) < field từng scene (`videoMode`, `sfxKey`, …).
- **Meta:** `profileId`, `presetPath`, `presetContentSha256`, `effectiveRenderConfig`.

Khóa chính: `ass` (font, màu ASS), `videoDefault` (`segmentVideoMode`, `placeholderRelativePath`, `outputFps`), `motionDefault`, `audio` (`bgmRelativePath`, `bgmVolume`, `ducking`, `sfx` map), `openai`, `elevenlabs.voice_settings`.

**Chọn file preset**

- API: `profileId` (chuỗi, không có `.json`) → đọc `DATA_ROOT/profiles/{profileId}.json`.
- Không gửi `profileId`: dùng `RENDER_PROFILE_ID` hoặc `DEFAULT_RENDER_PROFILE` trong `.env`, sau đó fallback tên trong code (vd. `cinematic_mystery`).

### 2.1. Knob: env, preset, tuning, scene

Thứ tự **trong `resolveRenderConfig`** (file [`render-config.ts`](../src/services/render-config.ts)):

1. **`defaultEffective`** — default trong code đã đọc **`.env`** (`ASS_*`, `SEGMENT_VIDEO_MODE`, `VIDEO_OUTPUT_FPS`, `DEFAULT_BROLL_PLACEHOLDER`, `BGM_PATH`, `BGM_VOLUME`, `AUDIO_MIX_MODE`, `OPENAI_*`, …).
2. **File preset** — chỉ field có trong JSON ghi đè bước 1 (`ass`, `videoDefault`, `motionDefault`, `audio`, `openai`, `elevenlabs`).
3. **`tuning`** (body API) — patch lồng nhau tương thích shape preset (`ass`, `videoDefault`, …).

Ở **từng scene** khi render: `motion`, `videoMode`, `sfxKey`, `videoPath`, `emphasisWords` cao hơn preset/`tuning` (xử lý trong pipeline).

Bật `PIPELINE_LOG=1` để log `config.resolved` sau khi merge.

---

## 3. `motion` và FFmpeg

`motion` chỉ điều khiển filter sau scale/crop 1080×1920 (zoom nhẹ, pan, shake, `static`) — toàn bộ qua FFmpeg.

---

## 4. `segmentVideoMode`

| Giá trị | Hành vi |
|---------|---------|
| `freeze_last` | Phát B-roll tối đa `min(T_video, T_audio)` rồi **giữ khung cuối** cho tới hết thoại cảnh |
| `loop` | Lặp nguồn với `-stream_loop -1` + `-shortest` theo audio |

Mặc định từ preset hoặc env `SEGMENT_VIDEO_MODE`.

---

## 5. SFX

Preset `audio.sfx`: ví dụ `hook`, `segment_start`. Timeline MVP: `hook` tại 0s; `segment_start` tại biên mỗi cảnh sau cảnh đầu; thêm entry nếu `scene.sfxKey` khớp key trong map. File **rel** `DATA_ROOT`; thiếu file → bỏ qua event đó.

---

## 6. `POST /jobs/render/from-video`

Tái dùng `meta.json`, `audio/*`, `scene-*.alignment.json`.  
`reuseRawVideo: true` — giữ `media/scenes/source-*.mp4` hiện có.  
`assembleOnly: true` — chỉ bước final trên `concat.mp4` (đổi ASS/BGM/SFX/preset).

Có thể gửi `profileId` / `tuning` để đổi look mà không gọi lại OpenAI/TTS (khi chỉ assemble hoặc khi chỉ cần config mới cho bước cuối).

---

## 7. Resume / tune theo bước (API)

Artifact trong `DATA_ROOT/jobs/{jobId}/`. Có thể chạy lại **từ giữa pipeline**:

| Mục tune | API | Điều kiện |
|----------|-----|-----------|
| Chỉ mux cuối: ASS, BGM, font, SFX (giữ `concat.mp4`) | `POST /jobs/render/from-video` + `assembleOnly: true` | Có `media/scenes/concat.mp4`, `audio/*`, alignment |
| Giữ B-roll đã ingest, encode lại clip → concat → final | `POST /jobs/render/from-video` + `reuseRawVideo: true` | Có `media/scenes/source-*.mp4`, mp3, alignment |
| Re-ingest B-roll rồi encode lại | `POST /jobs/render/from-video` + `reuseRawVideo: false` | mp3 + alignment có sẵn |
| Giữ kịch bản, làm lại **ElevenLabs + mọi bước sau TTS** | `POST /jobs/render` + **`resumeFrom: "tts"`** + cùng `jobId` | `meta.json` đã có `script.scenes` |

Body `resumeFrom: "tts"` vẫn có thể kèm `profileId`, `tuning`, `bgmPath` như render thường.

**Chưa hỗ trợ** “chỉ OpenAI lại”: muốn kịch bản mới thì gửi `idea` hoặc `scenes` và chạy full `POST /jobs/render` (có thể ghi đè artifact cùng job).

---

## 8. File liên quan

| Vai trò | File |
|---------|------|
| Resolve preset + merge | [`src/services/render-config.ts`](../src/services/render-config.ts) |
| Orchestrator | [`src/services/pipeline.service.ts`](../src/services/pipeline.service.ts) |
| FFmpeg / ASS | [`src/services/video.service.ts`](../src/services/video.service.ts) |
| Kịch bản OpenAI | [`src/services/script.service.ts`](../src/services/script.service.ts) |
| Đường dẫn job | [`src/shared/path-provider.ts`](../src/shared/path-provider.ts) |

---

## 9. E2E HTTP

- Helper seed: [`src/e2e/seed-minimal-job.ts`](../src/e2e/seed-minimal-job.ts) (`meta.json`, `audio/scene-*.mp3`, `scene-*.alignment.json`, `voice.mp3`).
- Test from-video: [`src/e2e/from-video.e2e.test.ts`](../src/e2e/from-video.e2e.test.ts); test full render (ElevenLabs): [`src/e2e/full-render.e2e.test.ts`](../src/e2e/full-render.e2e.test.ts).
- Chạy: `npm run test:e2e`. Biến: `E2E_HTTP` (bật on CI), `E2E_BASE_URL`, `E2E_DATA_ROOT` / `DATA_ROOT`, `E2E_PORT`, `ELEVENLABS_*` — chi tiết [README § Test E2E](../README.md#test-e2e-npm-run-teste2e).
