#!/usr/bin/env bash
# Cài ComfyUI-LivePortraitKJ + ComfyUI-VideoHelperSuite vào custom_nodes của ComfyUI.
# Dùng Python ≥ 3.12 (brew install python@3.12) cho venv ComfyUI.
set -euo pipefail

COMFY_ROOT="${COMFY_ROOT:-$HOME/SideProject/ComfyUI}"
NODES="$COMFY_ROOT/custom_nodes"

if [[ ! -d "$COMFY_ROOT" ]]; then
  echo "Không thấy ComfyUI tại: $COMFY_ROOT — clone repo hoặc export COMFY_ROOT=/đường/dẫn/ComfyUI"
  exit 1
fi

mkdir -p "$NODES"
cd "$NODES"

clone_or_pull() {
  local url="$1"
  local dir="$2"
  if [[ -d "$dir/.git" ]]; then
    git -C "$dir" pull --ff-only
  else
    rm -rf "$dir"
    git clone --depth 1 "$url" "$dir"
  fi
}

clone_or_pull https://github.com/kijai/ComfyUI-LivePortraitKJ.git ComfyUI-LivePortraitKJ
clone_or_pull https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git ComfyUI-VideoHelperSuite

VENV_PY="$COMFY_ROOT/venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "Chưa có venv tại $COMFY_ROOT/venv — tạo bằng: cd $COMFY_ROOT && python3.12 -m venv venv"
  exit 1
fi

if [[ -f "$NODES/ComfyUI-VideoHelperSuite/requirements.txt" ]]; then
  "$VENV_PY" -m pip install -r "$NODES/ComfyUI-VideoHelperSuite/requirements.txt"
fi

# LivePortraitKJ: trên macOS không có onnxruntime-gpu; dùng onnxruntime (CPU/CoreML).
if [[ "$(uname -s)" == "Darwin" ]]; then
  "$VENV_PY" -m pip install pyyaml opencv-python onnxruntime pykalman onnx2torch scikit-image numba
else
  if [[ -f "$NODES/ComfyUI-LivePortraitKJ/requirements.txt" ]]; then
    "$VENV_PY" -m pip install -r "$NODES/ComfyUI-LivePortraitKJ/requirements.txt"
  fi
fi

MODEL_DIR="$COMFY_ROOT/models/liveportrait"
if [[ ! -f "$MODEL_DIR/appearance_feature_extractor.safetensors" ]]; then
  echo "Đang tải weights LivePortrait (Kijai/LivePortrait_safetensors)…"
  mkdir -p "$MODEL_DIR"
  "$VENV_PY" -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Kijai/LivePortrait_safetensors', local_dir='$MODEL_DIR')"
fi

echo "Xong. Nếu dùng LivePortraitLoadFaceAlignmentCropper: xem docs/comfy-macos.md — có thể cần sửa 1 đoạn import trong face_alignment/api.py (tên folder có dấu gạch ngang)."
echo "Khởi chạy lại ComfyUI."
