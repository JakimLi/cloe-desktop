#!/bin/bash
# 安装打包好的 Cloe.app 到 /Applications
# 先杀进程、删旧 app、拷贝新 app、启动
set -e
cd "$(dirname "$0")/.."

APP_SRC="release/mac/Cloe.app"
APP_DST="/Applications/Cloe.app"

if [[ ! -d "$APP_SRC" ]]; then
    echo "✗ 找不到 $APP_SRC，先运行 ./scripts/pack.sh"
    exit 1
fi

echo "=== 安装 Cloe Desktop ==="

# [1] 杀掉正在运行的 Cloe
echo "[1/4] 关闭旧版..."
pkill -f "Cloe.app" 2>/dev/null || true
sleep 1

# [2] 删除旧 app（必须先删，否则 cp -R 可能不覆盖 asar）
echo "[2/4] 删除旧版..."
rm -rf "$APP_DST"

# [3] 拷贝新 app
echo "[3/4] 安装新版..."
cp -R "$APP_SRC" "$APP_DST"

# [4] 启动
echo "[4/4] 启动..."
open "$APP_DST"

# 等待就绪
for i in $(seq 1 10); do
    sleep 1
    STATUS=$(curl -s http://localhost:19851/status 2>/dev/null)
    if echo "$STATUS" | grep -q "clients"; then
        echo "✓ Cloe Desktop 已启动 ($STATUS)"
        exit 0
    fi
done
echo "⚠ 启动中，请稍等..."
