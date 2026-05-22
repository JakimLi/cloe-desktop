---
name: cloe-desktop-action
description: 通过 HTTP API 触发 Cloe 桌面表情动作、语音、画布绘图
---

# Cloe Desktop Action

## 前置检查

Cloe Desktop 必须在运行：

```bash
curl -s http://localhost:19851/status
# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
```

---

# Part 1 · 表情动作 & 语音

## 发现可用动作

**不要硬编码动作列表**，通过 API 实时获取：

```bash
curl -s http://localhost:19851/actions        # 动作列表（name + description）
curl -s http://localhost:19851/action-sets    # 动作集配置
```

## 触发表情

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

动作播放约 3 秒后自动恢复 idle 循环。间隔至少 3-5 秒，太快会被打断。

## 语音（speak）

> ⚠️ **禁止使用 Hermes 内置的 `text_to_speech` 工具。** 所有 TTS 走 `generate_tts.py`。

### 生成 + 播放（推荐）

```bash
# 生成音频并自动触发桌面 speak
python3 scripts/generate_tts.py --text "要说的话" --speak

# 只生成，输出 MP3 路径到 stdout
python3 scripts/generate_tts.py --text "要说的话"

# 指定输出路径 / provider
python3 scripts/generate_tts.py --text "要说的话" --output /tmp/custom.mp3
python3 scripts/generate_tts.py --text "要说的话" --provider cosyvoice
```

TTS provider 由 `~/.cloe/tts-config.json` 的 `provider` 字段决定（默认 `mosi`）。

### 手动播放已有音频

```bash
# 播放 TTS 缓存的音频
curl -s http://localhost:19851/action \
  -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>.mp3"}'

# 播放预录语音
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
# 可用: doing（"小可爱，我这就去做"）、done（"小可爱，做好了，你看看"）
```

speak 播放期间其他 action 被 drop，另一个 speak 可覆盖。长内容合并成一句 TTS 一次发完。

### 播放要点

- TTS 文本用完整连贯句子，少用省略号/波浪号
- 也可用 data URL 播放短音频（<5s）：`{"action":"speak","audio_url":"data:audio/mpeg;base64,..."}`

## 生成新动作

### 脚本生成（推荐）

```bash
# 默认绿幕
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。"

# 蓝幕（黑发效果更好）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "..." --chromakey blue

# 指定参考图
python3 scripts/generate_gif_v2.py \
  --action wave \
  --prompt "..." --reference ~/.cloe/references/default.png

# 自定义输出路径（不自动复制到 ~/.cloe/gifs/）
python3 scripts/generate_gif_v2.py \
  --action pout --prompt "..." --output /tmp/pout.gif --no-copy
```

生成后输出到 `~/.cloe/gifs/{action}.gif`，耗时约 3-5 分钟。

### 注册新动作

只复制 GIF 不够，必须同时更新 `~/.cloe/action-sets.json`：

1. 在活跃 set 的 `animations` 中添加：`"pout": "gifs/pout.gif"`
2. 在同一 set 的 `actionInfo` 中添加描述
3. Cloe 自动监听文件变化重载，无需重启
4. 验证：`curl -s http://localhost:19851/actions | jq '.[].name'`

### Prompt 写法要点

- 末尾必加「纯绿色背景」或「纯蓝色背景」
- 描述头部/上半身微动作，加「身体保持不动」
- 加「电影质感，高清」提高质量
- 时长一般 3-5 秒

### 管理界面 API（异步）

```bash
# 提交生成任务，返回 202 + taskId
curl -s -X POST http://localhost:19851/action-sets/default/generate-action \
  -H 'Content-Type: application/json' \
  -d '{"name":"pout","prompt":"...","duration":5}'

# 查询状态
curl -s http://localhost:19851/generation-tasks/<taskId>
```

自动完成 GIF 生成 + action-sets.json 更新 + 广播到 renderer。

## 自动触发（Plugin）

`~/.hermes/plugins/cloe-desktop/` 监听生命周期事件自动触发表情。

| Hook | 时机 | 动作 |
|------|------|------|
| `on_session_start` | 新 session | wave |
| `on_session_end` | 正常结束 | kiss |
| `on_session_end` | 被中断 | shake_head |
| `pre_llm_call` | LLM 调用前 | working |
| `post_llm_call` | LLM 调用后 | idle |

规则配置：`~/.cloe/plugin-rules.json`（5 秒缓存自动刷新），支持关键词匹配、context 阈值等。

修改 plugin 文件后需重启 Hermes 进程才能生效。

## 注意事项

- `clients=0` 时动作不生效
- `action-sets.json` 和 `plugin-rules.json` 支持热加载
- 带 walk_right/walk_left 等特殊逻辑的动作在 renderer.js 中有非标准处理，新增时注意不被通用分支吞掉

---

# Part 2 · Canvas 画布（Excalidraw）

## 切换画布模式

```bash
# 显示画布
curl -s -X POST http://localhost:19851/canvas/show \
  -H 'Content-Type: application/json' -d '{"mode":"canvas"}'

# 隐藏画布
curl -s -X POST http://localhost:19851/canvas/hide
```

## 配色规范

画布背景为**完全透明**，所有文字自动强制白色（不需要手动设置）。

容器/线条用饱和色系，`backgroundColor` 加 `33` 或 `44` 后缀做半透明填充：

```json
{ "strokeColor": "#a29bfe", "backgroundColor": "#a29bfe44" }
```

推荐色：`#a29bfe` 紫、`#55efc4` 绿、`#fd79a8` 粉、`#74b9ff` 蓝、`#ffeaa7` 黄。

## 绘制元素

```bash
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw \
  -H 'Content-Type: application/json' -d '{
  "elements": [
    { "id": "box1", "type": "rectangle", "x": 200, "y": 80,
      "width": 240, "height": 80,
      "strokeColor": "#ff6b6b", "backgroundColor": "#ff6b6b33",
      "roundness": { "type": 3 } },
    { "id": "text1", "type": "text", "x": 230, "y": 107,
      "text": "Hello", "fontSize": 22, "strokeColor": "#ff6b6b",
      "boundElements": [{ "id": "box1", "type": "rectangle" }] },
    { "id": "arrow1", "type": "arrow", "x": 320, "y": 160,
      "width": 0, "height": 80, "points": [[0,0],[0,80]],
      "strokeColor": "#a8e6cf", "strokeWidth": 2 }
  ]
}'
# 返回 {"ok":true,"count":3}
```

### 绘图规范

- **只需传最简 Skeleton JSON**（id、type、位置、尺寸、颜色），其他字段自动补全
- **禁止手动设置 text 的 width/height**，由 Excalidraw 自动计算（手动设会截断或崩溃）
- **容器自动撑大**：text 加 `boundElements` 关联容器后，容器自动扩展 + 文字自动居中，支持 rectangle/ellipse/diamond
- 绘制后自动 `scrollToContent({ fitToContent: true })` 对齐视口

## 注意力引导

```bash
# 缩放
curl -s -X POST http://localhost:19851/canvas/excalidraw/zoom \
  -H 'Content-Type: application/json' -d '{"level": 2}'

# 平移
curl -s -X POST http://localhost:19851/canvas/excalidraw/pan \
  -H 'Content-Type: application/json' -d '{"x": 100, "y": 200}'

# 选中元素
curl -s -X POST http://localhost:19851/canvas/excalidraw/select \
  -H 'Content-Type: application/json' -d '{"ids": ["id1"]}'

# 取消选中
curl -s -X POST http://localhost:19851/canvas/excalidraw/deselect

# 聚焦（推荐：集成缩放 + 平移 + 选中）
curl -s -X POST http://localhost:19851/canvas/excalidraw/focus \
  -H 'Content-Type: application/json' -d '{"ids": ["id1"]}'

# 删除元素
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/elements \
  -H 'Content-Type: application/json' -d '{"ids": ["id1"]}'
```

## 读取 / 清除

```bash
# 读取当前场景
curl -s http://localhost:19851/canvas/excalidraw/scene

# 清除画布
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/scene
```

## 注意事项

- Canvas 模式需要 launcher.js + CanvasMode.jsx 配合
- 改了 launcher.js 要重启 Electron，改了 JSX 文件 Vite HMR 自动生效
- 打包前必须清缓存：`rm -rf dist release node_modules/.vite`
