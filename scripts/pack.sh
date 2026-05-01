#!/bin/bash
# Cloe Desktop — 一键打包 DMG
# 用法: ./scripts/pack.sh [--dir]
#   默认打包 DMG
#   --dir 只打包目录（调试用，快很多）

set -e
cd "$(dirname "$0")/.."

echo "=== Cloe Desktop 打包 ==="

# [0] 清理旧产物，确保全量重建
echo "[0/3] 清理旧构建产物..."
rm -rf dist release

# [1] vite build (publicDir: false, 不拷贝 public/)
echo "[1/3] vite build..."
node ./node_modules/vite/bin/vite.js build

# [2] 只拷贝运行时需要的文件（排除 _work_* 中间产物）
echo "[2/3] 拷贝静态资源..."
mkdir -p dist/gifs dist/audio dist/references dist/manager
cp -f public/gifs/*.gif dist/gifs/
cp -f public/audio/*.mp3 dist/audio/
cp -f public/references/*.png dist/references/ 2>/dev/null || true
cp -rf public/manager/* dist/manager/
cp -f public/action-sets.json dist/action-sets.json 2>/dev/null || true
# Tray icon (extracted from icns, used in packaged Electron)
if [[ -f build/Cloe.iconset/icon_32x32.png ]]; then
    cp -f build/Cloe.iconset/icon_32x32.png dist/tray_icon.png
fi

# [2.5] 校验关键文件已包含最新代码
echo "[2.5/3] 校验打包文件..."
CHECKS_OK=true
for f in dist/manager/actions.js dist/manager/manager.js dist/manager/index.html dist/manager/actions.css; do
    if [[ ! -f "$f" ]]; then
        echo "  ✗ 缺失: $f"
        CHECKS_OK=false
    fi
done
if $CHECKS_OK; then
    echo "  ✓ 关键文件校验通过"
else
    echo "  ✗ 校验失败，请检查"
    exit 1
fi

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
