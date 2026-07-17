#!/usr/bin/env bash
# deploy.sh — Build, pack, and install Cloe Desktop
# Handles Python 3.12+ distutils removal: pre-compile node-pty, then skip rebuild
set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="Cloe"
APP_PATH="/Applications/${APP_NAME}.app"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

echo "⏳ Step 0: Clean caches (dist + release + .vite)..."
rm -rf dist release node_modules/.vite

echo "⏳ Step 1: vite build..."
npx vite build

echo "⏳ Step 2: Pre-compile node-pty for arm64 (bypass distutils issue)..."
npx electron-rebuild -f -w node-pty

echo "⏳ Step 3: electron-builder --dir (arm64, skip rebuild)..."
npx electron-builder --mac --dir --config.npmRebuild=false

echo "⏳ Step 4: Verify pty.node exists in output..."
PTY_NODE=$(find release/mac-arm64/Cloe.app -name "pty.node" -type f | head -1)
if [[ -z "$PTY_NODE" ]]; then
  echo "✗ pty.node 未找到! 终端将无法输入"
  exit 1
fi
echo "  ✓ Found: $PTY_NODE"

echo "⏳ Step 5: Kill running app..."
pkill -9 -f "${APP_NAME}.app" 2>/dev/null || true
sleep 1

echo "⏳ Step 6: Install to /Applications..."
rm -rf "$APP_PATH"
cp -R release/mac-arm64/Cloe.app "$APP_PATH"

# Verify asar
SRC_MD5=$(md5 -q release/mac-arm64/Cloe.app/Contents/Resources/app.asar)
DST_MD5=$(md5 -q "$APP_PATH/Contents/Resources/app.asar")
if [[ "$SRC_MD5" != "$DST_MD5" ]]; then
  echo "✗ asar MD5 不匹配!"; exit 1
fi
echo "  ✓ asar 校验通过"

echo "⏳ Step 7: Launch..."
open "$APP_PATH"
echo "✅ Done — deployed at $(date)"
