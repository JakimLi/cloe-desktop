#!/bin/bash
# Cloe Desktop — 一键打包 DMG
# 用法: ./scripts/pack.sh [--dir]
#   默认打包 DMG
#   --dir 只打包目录（调试用，快很多）

set -e
cd "$(dirname "$0")/.."

echo "=== Cloe Desktop 打包 ==="

# [1] vite build (publicDir: false, 不拷贝 public/)
echo "[1/3] vite build..."
node ./node_modules/vite/bin/vite.js build

# [2] 只拷贝运行时需要的文件（排除 _work_* 中间产物）
echo "[2/3] 拷贝静态资源..."
mkdir -p dist/gifs dist/audio
cp -f public/gifs/*.gif dist/gifs/
cp -f public/audio/*.mp3 dist/audio/

# [3] electron-builder
if [[ "$1" == "--dir" ]]; then
    echo "[3/3] electron-builder --dir..."
    ./node_modules/.bin/electron-builder --mac --dir
    echo ""
    echo "=== 完成! ==="
    echo "App: release/mac/Cloe.app"
    echo "运行: open release/mac/Cloe.app"
else
    echo "[3/3] electron-builder --mac (DMG)..."
    ./node_modules/.bin/electron-builder --mac
    echo ""
    echo "=== 完成! ==="
    DMG=$(ls -t release/*.dmg 2>/dev/null | head -1)
    if [[ -n "$DMG" ]]; then
        SIZE=$(du -h "$DMG" | cut -f1)
        echo "DMG: $DMG ($SIZE)"
    fi
fi
