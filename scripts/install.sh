#!/bin/bash
# 初始化数据目录（默认 ~/.cloe）；应用始终从 ~/.cloe/config.json 读取配置
CLOE_HOME="${1:-$HOME/.cloe}"
mkdir -p "$CLOE_HOME"/{gifs,references,audio}

# 从项目的 public/ 复制默认文件
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cp -n "$SCRIPT_DIR/public/gifs/"*.gif "$CLOE_HOME/gifs/" 2>/dev/null || true
cp -n "$SCRIPT_DIR/public/audio/"*.mp3 "$CLOE_HOME/audio/" 2>/dev/null || true
cp -n "$SCRIPT_DIR/public/references/"*.png "$CLOE_HOME/references/" 2>/dev/null || true
cp -n "$SCRIPT_DIR/public/action-sets.json" "$CLOE_HOME/action-sets.json" 2>/dev/null || true

mkdir -p "$HOME/.cloe"
if [ ! -f "$HOME/.cloe/config.json" ]; then
  ABS="$(cd "$CLOE_HOME" 2>/dev/null && pwd || echo "$CLOE_HOME")"
  if [ "$ABS" = "$HOME/.cloe" ]; then
    printf '%s\n' '{"version":1,"dataDir":"~/.cloe","language":"zh-CN","videoModel":"wan2.7-i2v"}' > "$HOME/.cloe/config.json"
  else
    node -e "const fs=require('fs');const p=require('path');const os=require('os');const abs=process.argv[1];const cfg={version:1,dataDir:abs,language:'zh-CN',videoModel:'wan2.7-i2v'};fs.writeFileSync(p.join(os.homedir(),'.cloe','config.json'),JSON.stringify(cfg,null,2));" "$ABS"
  fi
fi

echo "✓ Cloe 数据目录初始化完成: $CLOE_HOME"
