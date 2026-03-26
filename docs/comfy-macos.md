# ComfyUI trên macOS (native) + video-maker

Orchestrator trong repo **không** đóng gói ComfyUI. Trên macOS, chạy ComfyUI **native** để dùng **Metal**. Docker Linux trong Docker Desktop **không** ánh xạ GPU Apple sang container một cách đơn giản như Metal.

## 1. Cài và chạy ComfyUI

1. Clone [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (hoặc làm theo README upstream).
2. **Python:** bản upstream hiện cần **Python ≥ 3.10** (thực tế hay dùng **3.12**). Python 3.9 kèm macOS thường **không** cài được `requirements.txt`. Cài Homebrew Python rồi tạo venv, ví dụ:
   `brew install python@3.12` → `cd ComfyUI && /opt/homebrew/bin/python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt`
3. Cài stack **LivePortrait + Video Helper Suite** (custom nodes + pip phụ thuộc):

```bash
export COMFY_ROOT=/đường/dẫn/ComfyUI   # mặc định script: ~/SideProject/ComfyUI
./scripts/install-comfy-liveportrait.sh
```

4. Chạy server (giữ terminal mở):

   `./venv/bin/python main.py --listen 127.0.0.1 --port 8188`

5. Mở `http://127.0.0.1:8188` (GUI). Kiểm tra từ video-maker: `npm run check:comfy`.

Giữ terminal Comfy mở khi chạy `npm run dev` hoặc pipeline render.

## 2. Graph API (LivePortrait Kijai + VHS)

File: [`workflows/workflow_api.json`](../workflows/workflow_api.json). Các `class_type` chính:

| Node | Pack |
|------|------|
| `DownloadAndLoadLivePortraitModels` | [ComfyUI-LivePortraitKJ](https://github.com/kijai/ComfyUI-LivePortraitKJ) |
| `LivePortraitLoadFaceAlignmentCropper` | (idem) — crop bằng FaceAlignment / BlazeFace (đồ thị trong repo; trên một số máy có thể cần patch `face_alignment/api.py`, xem §5) |
| `LivePortraitCropper` / `LivePortraitRetargeting` / `LivePortraitProcess` / `LivePortraitComposite` | (idem) |
| `VHS_LoadVideoFFmpeg` | [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) — load mp4 từ Comfy **`input/`** (app copy `*_driving.mp4` vào đây) |
| `VHS_VideoCombine` | (idem) |
| `LoadImage` / `LoadAudio` | Comfy core |

**Quan trọng — hai nguồn khác nhau:**

- **Video lái (`driving_reference`)**: LivePortrait Kijai cần **chuỗi khung hình mặt chuyển động** (file mp4 đặt trong input). Đây **không** phải file TTS.
- **Giọng TTS (`*_voice.mp3`)**: trong graph Comfy vẫn đi vào `LoadAudio` / combine để **khớp môi** trên `raw.mp4`. **Sau đó** app Node còn bước đa cảnh: ghép giọng **theo từng cảnh** (`scene-*.mp3`) + FFmpeg; track âm thanh **cuối cùng** trong `final/output.mp4` là từ các cảnh đó (xem README pipeline).

**Chọn clip lái theo mood (mặc định):** đặt nhiều mp4 trong `shared_data/assets/driving/` và để **emotion cảnh đầu** trong `meta.json` quyết định file (vd. `laugh` → `laugh_mocking.mp4`). Bảng đầy đủ và hành vi ghi đè `COMFY_DRIVING_VIDEO` xem [**docs/pipeline.md** §3](pipeline.md#3-emotion--hai-vai-trò-khác-nhau).

**Fallback:** `shared_data/assets/driving_reference.mp4` hoặc **`COMFY_DRIVING_VIDEO`** (đường dẫn tuyệt đối) — khi set biến này, app **bỏ qua** map emotion. Độ dài clip nên gần thời lượng voice để giảm lệch (tinh chỉnh thêm `frame_rate` / workflow nếu cần).

**Mẫu chính thức từ upstream LivePortrait** (mặt + chuyển động, ví dụ `d0.mp4` ~3s, 512×512):

```bash
mkdir -p shared_data/assets
curl -sL "https://raw.githubusercontent.com/KwaiVGI/LivePortrait/main/assets/examples/driving/d0.mp4" \
  -o shared_data/assets/driving_reference.mp4
```

Các clip khác trong [thư mục driving](https://github.com/KwaiVGI/LivePortrait/tree/main/assets/examples/driving) (`d1.mp4`, …) có thể thay thế nếu cần motion khác.

Model LivePortrait tải lần đầu vào `ComfyUI/models/liveportrait` (HF). **Không commit** weights vào git.

**Nếu `class_type` lệch** với bản bạn cài: Export API từ Comfy và thay [`workflows/workflow_api.json`](../workflows/workflow_api.json), rồi cập nhật id trong [`src/config/comfy-workflow.ts`](../src/config/comfy-workflow.ts).

## 3. Cấu hình `video-maker` (`.env`)

### Bắt buộc khi `SKIP_COMFY=0`

- `COMFY_HTTP_URL` — thường `http://127.0.0.1:8188`.
- `COMFY_INPUT_DIR` / `COMFY_OUTPUT_DIR` — **đường dẫn tuyệt đối** tới `input` / `output` của ComfyUI.
- **`COMFY_WS_TIMEOUT_MS`** — timeout chờ job qua WebSocket (mặc định 1h); tăng nếu `voice.mp3` dài hoặc máy chậm.
- **`COMFY_OOM_MAX_RETRIES`** / **`COMFY_OOM_RETRY_SEC`** — retry khi Comfy báo hết VRAM (mặc định 3 lần, cách nhau 30s).
- **Driving video:** ưu tiên **`COMFY_DRIVING_VIDEO`** (ghi đè); không set thì map `DATA_ROOT/assets/driving/*.mp4` theo emotion hook + fallback `driving_reference.mp4` — [pipeline.md §3](pipeline.md#31-comfy--liveportrait--chỉ-cảnh-đầu-hook).

App copy vào input: `*_master.*`, `*_voice.mp3`, `*_driving.mp4`. Các file **phải** nằm trong đúng thư mục `input` mà **process Comfy** đang dùng (mặc định `ComfyUI/input` nếu bạn không truyền `--input-directory`). Chỉ set `COMFY_INPUT_DIR` trỏ vào `shared_data/comfy_input` **mà Comfy vẫn chạy mặc định** sẽ lỗi `Invalid … file`: hai bên không tự đồng bộ. Cách đúng: hoặc `.env` dùng đường dẫn tuyệt đối tới `…/ComfyUI/input` và `…/ComfyUI/output`, hoặc bật Comfy với `python main.py --input-directory …/shared_data/comfy_input --output-directory …/shared_data/comfy_output` trùng `.env`.

- Đặt `COMFY_ROOT` (đường dẫn gốc ComfyUI có `main.py`, `input/`, `output/`) **hoặc** `COMFY_INPUT_DIR` / `COMFY_OUTPUT_DIR`.
- Nếu đều để trống, app sẽ thử lần lượt: `../ComfyUI` (cạnh repo), `~/SideProject/ComfyUI`, `~/ComfyUI`.

### Để trống `COMFY_INPUT_DIR` / `COMFY_OUTPUT_DIR`

Code dùng `shared_data/comfy_input` và `shared_data/comfy_output` — chỉ ổn nếu trùng path với Comfy (symlink hoặc cấu hình).

### Khi chưa cài Comfy

```env
SKIP_COMFY=1
```

Pipeline bỏ bước Comfy (placeholder video), vẫn chạy script / ElevenLabs / cắt cảnh FFmpeg / concat / ASS.

**Chỉ chạy lại từ Comfy / FFmpeg** (không OpenAI, không ElevenLabs): dùng `POST /jobs/render/from-video` sau khi đã có job đủ `audio/*` và `scene-*.alignment.json` — chi tiết README gốc.

## 4. Kiểm tra Comfy có sống

```bash
npm run check:comfy
```

Phải thấy Comfy trả lời trước khi `POST /jobs/render` với `SKIP_COMFY=0`.

## 5. macOS — lỗi thường gặp (LivePortrait KJ)

**`Node 'VHS_LoadVideoFFmpegUpload' not found`** — bản Video Helper Suite đăng ký node **`VHS_LoadVideoFFmpeg`** (đọc file trong `input/`). Graph trong repo dùng tên này; đừng đổi sang `…Upload` trừ khi bạn export lại đúng `class_type` từ Comfy của bạn.

**`appearance_feature_extractor.safetensors` không có** — tải full snapshot (hoặc chạy lại `./scripts/install-comfy-liveportrait.sh`, có bước tải HF):

```bash
./venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Kijai/LivePortrait_safetensors', local_dir='models/liveportrait')"
```
(chạy trong thư mục gốc ComfyUI, đã có `venv`.)

**`No module named 'ComfyUI-LivePortraitKJ'` khi chạy FaceAlignment cropper** — trong `custom_nodes/ComfyUI-LivePortraitKJ/face_alignment/api.py`, đoạn `import_module(..., package=package_directory_name)` dùng tên folder có dấu `-`, không phải tên package Python hợp lệ. Sửa nhánh “Get the face detector” thành thêm `_ext_root` vào `sys.path` rồi `importlib.import_module('face_alignment.detection.' + face_detector)` (và thêm `import sys` nếu chưa có). Bản sửa đã áp dụng trên máy dev khi chạy E2E.

**Cập nhật / git pull custom node** có thể **ghi đè** `face_alignment/api.py`. Nếu lỗi import quay lại, áp dụng lại patch hoặc lưu diff vào chỗ an toàn (repo video-maker không chứa bản vá trong ComfyUI).

**`COMFY_INPUT_DIR` trống** — ComfyUI mặc định đọc `ComfyUI/input`, còn app copy vào `shared_data/comfy_input`. Nên set trong `.env`:

```env
COMFY_INPUT_DIR=/đường/dẫn/ComfyUI/input
COMFY_OUTPUT_DIR=/đường/dẫn/ComfyUI/output
```
