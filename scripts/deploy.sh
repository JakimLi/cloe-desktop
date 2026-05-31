#!/usr/bin/env bash
# deploy.sh — Build, pack, and install Cloe Desktop
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="Cloe"
APP_PATH="/Applications/${APP_NAME}.app"

echo "⏳ Step 0: Clean caches..."
rm -rf dist node_modules/.vite

echo "⏳ Step 1: vite build..."
npm run build

echo "⏳ Step 2: electron-builder pack..."
npm run pack

echo "⏳ Step 3: Kill running app..."
pkill -f "${APP_NAME}.app" 2>/dev/null || true
sleep 1

echo "⏳ Step 4: Install to /Applications (rm + cp)..."
rm -rf "$APP_PATH"
# Find the built app — dir mode uses mac-arm64, DMG mode uses mac-universal
BUILT_APP=""
for dir in release/mac-arm64 release/mac release/mac-universal; do
  if [[ -d "$dir/${APP_NAME}.app" ]]; then
    BUILT_APP="$dir/${APP_NAME}.app"
    break
  fi
done
if [[ -z "$BUILT_APP" ]]; then
  echo "✗ 未找到打包产物"; exit 1
fi
cp -R "$BUILT_APP" "$APP_PATH"

# Verify asar was replaced (cp -R into existing dir may not overwrite on macOS)
if [[ -f "$BUILT_APP/Contents/Resources/app.asar" ]]; then
  SRC_MD5=$(md5 -q "$BUILT_APP/Contents/Resources/app.asar")
  DST_MD5=$(md5 -q "$APP_PATH/Contents/Resources/app.asar")
  if [[ "$SRC_MD5" != "$DST_MD5" ]]; then
    echo "✗ asar MD5 不匹配! 源=$SRC_MD5 目标=$DST_MD5"; exit 1
  fi
  echo "  ✓ asar 校验通过"
fi

echo "⏳ Step 5: Launch..."
open "$APP_PATH"
echo "✅ Done — deployed at $(date)"
