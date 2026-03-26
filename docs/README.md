# Tài liệu

| Tài liệu | Mục đích |
|----------|----------|
| [README.md](../README.md) ở gốc repo | Cài đặt, biến môi trường, API (`/jobs/render`, `/jobs/render/from-video`), Docker, workflow Comfy (tóm tắt) |
| [**pipeline.md**](pipeline.md) | Luồng chi tiết đa cảnh, bảng `emotion` → driving / FFmpeg, artifact `audio/*`, reuse, test `verify:driving`, liên kết mã nguồn |
| [**dev-phases.md**](dev-phases.md) | Phase dev ($0 → trả phí): Definition of done + bảng test T0–T4, cổng chuyển phase |
| [comfy-macos.md](comfy-macos.md) | ComfyUI native macOS, LivePortrait KJ, VHS, model, symlink / `COMFY_INPUT_DIR` / `COMFY_OUTPUT_DIR`, lỗi thường gặp |
| [.env.example](../.env.example) | Mẫu `.env` có comment |

**Luồng đọc gợi ý**

1. README gốc — nắm cài đặt và API.
2. **[pipeline.md](pipeline.md)** — driving, artifact job, alignment, reuse.
3. **[dev-phases.md](dev-phases.md)** — checklist đa cảnh ~60s, DoD + test T0–T4 ($0 trước).
4. Nếu bật Comfy (`SKIP_COMFY=0`): **comfy-macos.md** → `npm run check:comfy` → tuỳ chọn `npm run verify:driving`.
