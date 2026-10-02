#!/bin/sh
# Builds dist/claude-chat-colors-<version>.zip containing only what Chrome needs.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/claude-chat-colors-$VERSION.zip"
mkdir -p dist
rm -f "$OUT"
zip -qr "$OUT" manifest.json src popup icons README.md -x '*.DS_Store'
echo "$OUT"
