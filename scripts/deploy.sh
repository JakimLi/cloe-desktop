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
cp -R "release/mac-universal/${APP_NAME}.app" "$APP_PATH"

echo "⏳ Step 5: Launch..."
open "$APP_PATH"
echo "✅ Done — deployed at $(date)"
