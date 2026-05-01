# Cloe Desktop 数据目录设计

## 目标

1. **跨平台**：不绑定 macOS userData，统一用 `~/.cloe/`
2. **可配置**：app 内可修改数据目录路径
3. **Hermes 可写**：skill 直接写文件到数据目录，app 自动识别
4. **安装脚本**：一键初始化默认文件

## 目录结构

```
~/.cloe/                          ← CLOE_HOME（可配置）
├── config.json                   ← 全局配置（API key、数据目录、语言等）
├── action-sets.json              ← 动作集配置
├── gifs/                         ← 所有 GIF 动画
│   ├── blink.gif
│   ├── smile.gif
│   ├── heart.gif                 ← AI 生成 / Hermes skill 写入
│   └── _work_heart/              ← 生成中间产物
├── references/                   ← 参考图（每个 set 一张）
│   ├── default.png
│   └── cutekeke_63392.png
└── audio/                        ← TTS 预录音频
    ├── doing.mp3
    └── done.mp3
```

## config.json

```json
{
  "version": 1,
  "dataDir": "~/.cloe",
  "dashscopeApiKey": "sk-xxx",
  "videoModel": "wan2.7-i2v",
  "language": "zh-CN"
}
```

- `dataDir`：数据根目录，默认 `~/.cloe`
- Hermes skill 读 `~/.cloe/config.json` 获取 `dataDir`，写入 `dataDir/gifs/`
- App 启动时读 `config.json`，如果 `dataDir` 不存在则创建并从 asar 复制默认文件

## 路径解析优先级

App 读取文件时：

```
1. {dataDir}/gifs/xxx.gif         ← 用户生成 / Hermes 写入（优先）
2. asar:dist/gifs/xxx.gif          ← 内置默认（降级）
```

写入一律到 `{dataDir}/` 下。

## 安装脚本 `scripts/install.sh`

```bash
#!/bin/bash
# 初始化 ~/.cloe 数据目录
CLOE_HOME="${1:-$HOME/.cloe}"
mkdir -p "$CLOE_HOME"/{gifs,references,audio}

# 从项目的 public/ 复制默认文件
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cp -n "$SCRIPT_DIR/public/gifs/"*.gif "$CLOE_HOME/gifs/"
cp -n "$SCRIPT_DIR/public/audio/"*.mp3 "$CLOE_HOME/audio/"
cp -n "$SCRIPT_DIR/public/references/"*.png "$CLOE_HOME/references/"
cp -n "$SCRIPT_DIR/public/action-sets.json" "$CLOE_HOME/action-sets.json"

# 生成默认 config.json（如果不存在）
if [ ! -f "$CLOE_HOME/config.json" ]; then
  cat > "$CLOE_HOME/config.json" << 'EOF'
{"version":1,"dataDir":"~/.cloe","language":"zh-CN"}
EOF
fi

echo "✓ Cloe 数据目录初始化完成: $CLOE_HOME"
```

## renderer 加载 GIF 的方式

不再需要 HTTP 静态文件服务。通过 preload.js 暴露 dataDir 路径：

```js
// preload.js
contextBridge.exposeInMainWorld('electronAPI', {
  moveWindow: (dx, dy) => ipcRenderer.send('window-move', { dx, dy }),
  getDataDir: () => ipcRenderer.sendSync('get-data-dir'),
});
```

```js
// renderer.js
const DATA_DIR = window.electronAPI?.getDataDir() || '';
const BASE = (location.protocol === 'file:' && DATA_DIR)
  ? `file://${DATA_DIR}/`
  : '/';
```

这样 renderer 直接用 `file://` 加载本地文件，不需要 HTTP 中转。

## Hermes Skill 交互

Hermes skill（如 cloe-moment、cloe-video、新增动作）：

1. 读 `~/.cloe/config.json` 获取 `dataDir`
2. 写 GIF 到 `{dataDir}/gifs/xxx.gif`
3. 更新 `{dataDir}/action-sets.json` 的 animations
4. `curl http://localhost:19851/action -d '{"action":"xxx"}'` 触发播放

## 迁移计划

从当前 userData 路径迁移到 `~/.cloe/`：

1. App 首次启动检测：如果 `~/.cloe/` 不存在但有旧数据，自动迁移
2. 旧路径 `~/Library/Application Support/cloe-desktop/` → 新路径 `~/.cloe/`
3. 迁移后旧数据保留不删除（安全）

## 好处

- **跨平台**：`~/.cloe/` 在 Linux/macOS/Windows 都能用
- **Hermes 友好**：固定路径，skill 不用猜
- **用户可配**：想放哪放哪
- **简洁**：砍掉 HTTP 静态文件服务，去掉 `getPublicAssetsRoot`/`getWritableAssetsRoot` 等多个路径函数
- **asar 只读 bundle**：asar 只放初始数据，运行时全部用 `~/.cloe/`
