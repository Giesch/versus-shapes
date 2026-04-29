#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

yt-dlp \
  -x \
  --audio-format mp3 \
  --audio-quality 0 \
  --no-playlist \
  -o "$PROJECT_ROOT/public/versus-shapes.%(ext)s" \
  "https://www.youtube.com/watch?v=TEMke0TGKkY"
