#!/usr/bin/env bash
set -euo pipefail

REF="${1:-master}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="$SCRIPT_DIR/app/src/main/cpp/third_party"
LLAMA_DIR="$VENDOR_DIR/llama.cpp"

mkdir -p "$VENDOR_DIR"

if [ -d "$LLAMA_DIR/.git" ]; then
  echo "Updating existing llama.cpp checkout..."
  git -C "$LLAMA_DIR" fetch --tags origin
  git -C "$LLAMA_DIR" checkout "$REF"
  git -C "$LLAMA_DIR" pull --ff-only origin "$REF" || true
else
  echo "Cloning llama.cpp into $LLAMA_DIR ..."
  git clone https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
  git -C "$LLAMA_DIR" checkout "$REF"
fi

COMMIT="$(git -C "$LLAMA_DIR" rev-parse HEAD)"
cat > "$SCRIPT_DIR/LLAMA_CPP_PIN.txt" <<EOF
repo=https://github.com/ggml-org/llama.cpp
ref=$REF
commit=$COMMIT
path=app/src/main/cpp/third_party/llama.cpp
EOF

echo "llama.cpp vendored at commit $COMMIT"
echo "Pin written to $SCRIPT_DIR/LLAMA_CPP_PIN.txt"
