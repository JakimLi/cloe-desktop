---
name: cloe-desktop-action
description: 通过 HTTP API 动态发现和触发 Cloe 桌面角色的表情动作动画
---

# Cloe Desktop Action — 桌面动画触发

## 前置条件

Cloe Desktop 必须在运行：

```bash
curl -s http://localhost:19851/status
# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
```

## 动态发现可用动作

**不要硬编码动作列表。** 通过 API 实时获取：

```bash
curl -s http://localhost:19851/actions
curl -s http://localhost:19851/action-sets
```

`GET /actions` 返回含 `name`、`description`、`hookNames`、`special` 等字段的动作列表。用 `description` 匹配语境，用 `name` 或 `hookNames` 触发。

## 触发动作

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

动作播放约 3 秒后自动恢复 idle 循环。

## 语音动作（speak）

> ⚠️ **禁止使用 Hermes 内置的 `text_to_speech` 工具。** 所有 TTS 必须使用 `~/.cloe/tts-config.json` 配置的 provider（默认 mosi）。

### 方式一：TTS 动态语音（推荐）

链路：`generate_tts.py` 生成 MP3 → 保存到 `~/.cloe/audio_cache/` → bridge `/tts/` 路由 serve → speak 播放。

#### 脚本：`scripts/generate_tts.py`

**唯一正确的 TTS 调用方式**，自动读取 `~/.cloe/tts-config.json` 配置。

```bash
# 生成音频（输出 MP3 路径到 stdout）
python3 scripts/generate_tts.py --text "要说的话"

# 生成 + 自动触发桌面 speak 播放
python3 scripts/generate_tts.py --text "要说的话" --speak

# 指定输出路径
python3 scripts/generate_tts.py --text "要说的话" --output /tmp/custom.mp3

# 强制指定 provider
python3 scripts/generate_tts.py --text "要说的话" --provider cosyvoice
```

stdout 只输出 MP3 文件路径，日志输出到 stderr。

#### 配置 TTS Provider

配置文件：`~/.cloe/tts-config.json`（**唯一的 TTS 配置来源**）

```json
{
  "provider": "mosi",
  "mosi": {
    "api_key": "<MOSI_API_KEY>",
    "voice_id": "2036257587296473088",
    "url": "https://studio.mosi.cn/v1/audio/tts"
  },
  "cosyvoice": {
    "api_key_env": "BAILIAN_API_KEY",
    "model": "cosyvoice-v1",
    "voice": "longmiao"
  }
}
```

**provider 字段**选择 TTS 引擎：
- `"mosi"` — MOSI 云端 TTS（可可音色，快 ~3s）**← 默认**
- `"cosyvoice"` — 阿里云 CosyVoice（多音色可选）

#### MOSI API 调用规范（⚠️ 脚本已封装，一般不需要手动调）

如果手动调用，**必须**按以下格式：

```python
headers = {
    "Authorization": f"Bearer {api_key}",  # ← 必须用 Bearer auth
    "Content-Type": "application/json",
}
payload = {
    "model": "moss-tts",        # ← 必须有
    "text": text,
    "voice_id": voice_id,
    "sampling_params": {"temperature": 1.7, "top_p": 0.8, "top_k": 25},
}
resp = requests.post(url, json=payload, headers=headers)
# 返回 {"audio_data": "<base64>"}，解码后是 WAV → 必须 ffmpeg 转 MP3
```

❌ 不带 `Authorization` header 或 body 不含 `model` 字段 → 401。

#### 播放要点

- TTS 文本用完整连贯句子，少用省略号/波浪号
- MOSI 返回 WAV，脚本自动转 MP3（Electron `new Audio()` 播放 WAV 不完整）
- 也可以手动 speak 已有音频：`curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>.mp3"}'`
- **speak 播放期间其他 action 被 drop，另一个 speak 可覆盖**——长内容合并成一句 TTS 一次发完

### 方式二：预录语音（`audio` 字段）

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
```

预录文件存放在 `~/.cloe/audio_cache/`，和 TTS 共用 `GET /tts/` 路由。
现有预录文件：`doing.mp3`（"小可爱，我这就去做"）、`done.mp3`（"小可爱，做好了，你看看"）。

添加新语音：TTS 生成 → `ffmpeg` 转 mp3 → 放 `~/.cloe/audio_cache/`。

### 方式三：data URL（短音频，<5s）

base64 编码后传 `data:audio/mpeg;base64,...`，curl 上限约 128KB。

## 系统动作

| 动作 | 触发方式 | 说明 |
|------|---------|------|
| `working` | plugin pre_llm_call / gateway agent:start | 敲键盘，锁定工作模式 |
| `idle` | plugin post_llm_call / gateway agent:end | 恢复 idle 循环 |
| `wave` | plugin on_session_start | 新会话打招呼 |
| `kiss` | plugin on_session_end | 会话结束 |

### ⚠️ Gateway hooks vs Plugin hooks（TUI 兼容性）

**Gateway hooks**（`~/.hermes/hooks/`）只在 GatewayRunner 中触发。**TUI 模式**（`hermes --tui`）不走 GatewayRunner，直接调 `run_agent.AIAgent`，所以 gateway hooks 在 TUI 下**不触发**。

**Plugin hooks**（`~/.hermes/plugins/`）通过 `run_agent.py` 里的 `invoke_hook` 调用，**所有模式都触发**（gateway server、TUI、直接调用）。

因此，working/idle 的触发**必须依赖 plugin**，不能依赖 gateway hook。当前实现：
- `pre_llm_call` → working（turn 开始时触发）
- `post_llm_call` → idle（turn 正常结束时触发）
- `on_session_end` → idle（兜底，处理中断/崩溃）

Gateway hook 的 `agent:start → working` 只是冗余保障，不是主要触发源。

## Hermes Plugin（自动触发）

`~/.hermes/plugins/cloe-desktop/` 监听生命周期事件自动触发表情。

### 触发规则（plugin-rules.json）

存在 `~/.cloe/plugin-rules.json`，5 秒缓存自动刷新。

```json
{
  "min_interval": 1.5,
  "tool_expressions": {},  // working 由 pre_llm_call 触发，不需要 per-tool 映射
  "tool_completions": {"delegate_task": "clap", "execute_code": "nod"},
  "keyword_map": [
    {"keywords": ["晚安", "睡了"], "action": "kiss"}
  ],
  "context_thresholds": {
    "warning": {"pct": 75, "action": "think"},
    "critical": {"pct": 90, "action": "shake_head"}
  }
}
```

### Plugin 监听的 Hooks

| Hook | 时机 | 动作 |
|------|------|------|
| on_session_start | 新 session | wave |
| on_session_end | 正常结束 | kiss |
| on_session_end | 被中断 | shake_head |
| pre_tool_call | 工具执行前 | 按 tool_expressions |
| post_tool_call | 工具完成后 | 按 tool_completions |
| pre_llm_call | LLM 调用前 | 关键词匹配 |
| post_llm_call | LLM 调用后 | idle + 超长→yawn |
| post_api_request | API 请求后 | context 阈值 |
| subagent_stop | 子 agent 完成 | 成功→clap / 失败→shake_head |

> 修改 plugin 文件后需重启 Hermes gateway 进程（gateway 模式）或 TUI 进程（`hermes --tui`）才能生效。

### Plugin Handler 部署同步

- **源文件**：`~/work/cloe-desktop/docs/hermes-plugin/handler.py`（仓库里的权威版本）
- **部署文件**：`~/.hermes/plugins/cloe-desktop/handler.py`（Hermes 运行时加载的）
- 两者可能**漂移**——部署版可能多出已废弃的代码（如 `_mirror_send`、`MIRROR_URL`）
- 同步后**必须清除 `__pycache__`**：`rm -rf ~/.hermes/plugins/cloe-desktop/__pycache__`
- **已废弃不应存在的代码**：`_mirror_send()`、`MIRROR_URL`、`_summarize_args()`（`/mirror` 端点已从 bridge 移除，保留只会产生 404 报错日志）

## 生成新动作（GIF Pipeline）

Cloe 可以自己生成新动作！完整链路：参考图 → AI 视频 → chromakey → 透明 GIF。

### 方式一：脚本直接生成（推荐，不依赖后台服务）

```bash
# 单个生成（默认绿幕，输出到 ~/.cloe/gifs/{action}.gif）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。"

# 蓝幕模式（对黑发效果更好）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯蓝色背景。电影质感，高清。" \
  --chromakey blue

# 指定参考图
python3 scripts/generate_gif_v2.py \
  --action wave \
  --prompt "她开心地挥手打招呼，身体保持不动。纯蓝色背景。电影质感，高清。" \
  --reference ~/.cloe/references/default.png

# 自定义输出路径（不自动复制到 ~/.cloe/gifs/）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "..." \
  --output /tmp/pout.gif --no-copy
```

**脚本自动完成**：压缩参考图（>4MB）→ 百炼 wan2.7-i2v 生成视频 → ffmpeg chromakey → Python 去色晕 → 透明 GIF → 复制到 `~/.cloe/gifs/`。

**生成后必须注册动作**（⚠️ 脚本不会自动注册！）：

1. 编辑 `~/.cloe/action-sets.json`，在活跃 set 的 `animations` 中添加：
   ```json
   "pout": "gifs/pout.gif"
   ```
2. 在同一 set 的 `actionInfo` 中添加描述：
   ```json
   "pout": {
     "description": "嘟嘴，小可爱气到她的时候",
     "descriptionEn": "Pout — upset, sulking"
   }
   ```
3. Cloe 自动监听文件变化重载，无需重启。
4. 验证：`curl -s http://localhost:19851/actions` 检查新动作是否出现。
5. 测试播放：`curl -s http://localhost:19851/action -d '{"action":"pout"}'`

> ⚠️ **只复制 GIF 文件到 `~/.cloe/gifs/` 不够**——`/actions` API 不会列出未注册的动作，触发也不生效。必须同时更新 action-sets.json。
>
> ⚠️ 脚本需要 `requests`、`PIL`、`numpy`、`scipy`，用系统 Python 跑（不用 execute_code）。

### 方式二：管理界面 API（需 bridge 服务运行）

```bash
# 异步生成，立即返回 202 + taskId
curl -s -X POST http://localhost:19851/action-sets/default/generate-action \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pout",
    "prompt": "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。",
    "duration": 5
  }'

# 查询任务状态
curl -s http://localhost:19851/generation-tasks/<taskId>
```

**自动完成**：生成 GIF → 更新 action-sets.json → 广播到 renderer。无需手动改代码。

### Prompt 写法要点

- **身体保持不动**：只描述头部/上半身微动作，避免大幅移动
- **纯色背景**：末尾必须加"纯绿色背景"或"纯蓝色背景"
- **电影质感，高清**：提高生成质量
- **时长**：一般 3-5 秒（idle 3 秒，表情 5 秒）
- 参考示例：`"她微微嘟起嘴唇，表情可爱委屈。身体保持不动。纯绿色背景。电影质感，高清。"`

### ⚠️ 带特殊逻辑的动作（walk_right 等）

renderer.js 中某些动作有非标准处理逻辑（如 `walk_right` 会触发窗口移动），这些特殊判断必须在 `ACTION_MAP` 通用查找**之前**执行。但 launcher.js 在注册新动作时会自动 `set.actionMap[name] = name`，导致新动作被通用分支抢先匹配，特殊逻辑永远不执行。

**检查方法**：如果加了动作后触发效果不对（比如 walk 只播放 GIF 不移动），说明被通用分支吞了。需要在 `src/renderer.js` 的 `handleAction` 函数中，把特殊动作的判断提前到 `ACTION_MAP[action]` 查找之前。

**当前有特殊逻辑的动作**：`walk_right`、`walk_left`（窗口移动）、`working`（锁定模式）、`idle`（恢复模式）、`speak`（音频同步）。

### Walk 动作架构（walk_right / walk_left）

Walk 是目前最复杂的动作，涉及窗口移动 + GIF 切换 + 边缘检测 + 方向切换。

#### 实现要点

1. **方向 GIF 分离**：`walk_right` 和 `walk_left` 是两个独立 GIF 文件，`walk_left` 是 `walk_right` 的水平镜像（PIL `transpose(Image.FLIP_LEFT_RIGHT)`）
2. **GIF 锁定**：走路期间必须锁定 GIF 不被 idle/reaction/set-config 替换。`isWalking` 必须在以下位置检查：
   - `scheduleNextIdle()` — 阻止 idle 定时器
   - `playRandomIdle()` — 阻止随机 idle 切换
   - `startIdleLoop()` — 阻止 WebSocket 重连/reconfig 时的 idle 恢复
   - `handleAction()` 开头 — 走路期间 drop 其他动作（除 idle/walk）
3. **边缘检测**：通过 `getWorkAreaSize` IPC（preload + launcher.js）获取屏幕尺寸，在 `startWalk` 中每帧检查窗口位置，到达边缘时掉头
4. **掉头时切换 GIF**：方向反转时调用 `switchWalkGif(direction)` 切换到对应的 walk_right/walk_left GIF
5. **回到原点停止**：记录起始 X 坐标，第一次掉头后回到原点（±2px 容差）自动 `stopWalk()`

#### Walk 相关的 IPC API

- `getWorkAreaSize` → `{ width, height }` — 屏幕工作区尺寸（preload.js + launcher.js）
- `getWindowPosition` → `{ x, y }` — 窗口当前位置（已有）

#### GIF 帧裁剪

AI 生成的走路 GIF 前几帧通常包含起立/预备动作（质心 Y 从~380 跳到~470+），需要裁掉：

```python
from PIL import Image
src = Image.open("walk_right.gif")
frames = []
for i in range(13, src.n_frames):  # 跳过前 13 帧
    src.seek(i)
    frames.append(src.copy())
frames[0].save("walk_right_trimmed.gif", save_all=True, append_images=frames[1:],
               duration=100, loop=0, disposal=2, transparency=0)
```

**如何确定裁剪点**：分析每帧质心 Y，找到稳定周期性波动的起始帧。

#### 生成 walk_left 镜像

```python
frames_left = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in frames]
frames_left[0].save("walk_left.gif", save_all=True, append_images=frames_left[1:],
                    duration=100, loop=0, disposal=2, transparency=0)
```

### 已知限制

- 每次生成耗时 ~3-5 分钟（百炼 API 异步轮询）
- 绿幕对黑发有轻微残留，蓝幕效果更好
- 修改 renderer.js 后必须重新 `npm run pack` 打包部署，不能只改 action-sets.json

## Canvas 画布 API（Excalidraw）

Cloe Desktop 内嵌 Excalidraw 画布，AI 可通过 HTTP bridge 实时绘图。

### 前置条件

Cloe Desktop 运行中，Canvas 模式已激活：

```bash
# 切换到 Canvas 模式
curl -s -X POST http://localhost:19851/canvas/show \
  -H 'Content-Type: application/json' -d '{"mode":"canvas"}'

# 隐藏 overlay
curl -s -X POST http://localhost:19851/canvas/hide
```

### ⚠️ 深色背景配色建议

Cloe Desktop 画布背景为**黑色透明**（`viewBackgroundColor: transparent`），深色文字几乎不可见。

**文字颜色**：默认用 `#ffffff`（白色）或浅色（`#dfe6e9`、`#b2bec3`）
**容器/线条**：用饱和色系（`#a29bfe` 紫、`#55efc4` 绿、`#fd79a8` 粉、`#74b9ff` 蓝、`#ffeaa7` 黄），`backgroundColor` 加 `33` 或 `44` 后缀做半透明填充

示例配色：
```json
{ "strokeColor": "#a29bfe", "backgroundColor": "#a29bfe44" }
```

### 绘制元素

```bash
# POST /canvas/excalidraw/draw
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

**只需传最简 Skeleton JSON**（id、type、位置、尺寸、颜色），CanvasMode.jsx 通过 `convertToExcalidrawElements` 自动补全所有必需字段（angle、opacity、isDeleted、groupIds、seed、version 等）并正确计算文字尺寸。

绘制后自动调用 `scrollToContent({ fitToContent: true })` 让视口对齐内容。

### ⚠️ 文字尺寸 & 容器自动适配

1. **文字宽高必须由 Excalidraw 计算**：禁止手动估算 text 的 `width`/`height`，`updateScene` 不会触发 `autoResize`，手动算的一定不准（文字截断或 hit-test 崩溃）。所有 skeleton 统一走 `convertToExcalidrawElements`，自动算出正确尺寸。

2. **容器自动撑大**：text 元素加 `boundElements` 关联容器后，容器自动扩展到 `文字宽高 + 48px padding`，文字自动居中：
   ```json
   { "id": "text1", "type": "text", "text": "任意长度文字",
     "boundElements": [{ "id": "box1", "type": "rectangle" }] }
   ```
   - 容器写最小宽高即可，不够会自动扩展（取 `max(原始宽高, 文字宽高+padding)`）
   - 支持 rectangle、ellipse、diamond 三种容器
   - 不加 `boundElements` 的纯文字/纯框不受影响
   - 容器位置由 skeleton 中的 `x`/`y` 决定，文字会自动居中到容器内

### 读取 / 清除场景

```bash
# 读取当前场景所有元素
curl -s http://localhost:19851/canvas/excalidraw/scene

# 清除画布
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/scene
```

### ⚠️ 程序化绘图必须使用 convertToExcalidrawElements

CanvasMode.jsx 的 `updateScene` 内部会调用 `convertToExcalidrawElements(incoming, { regenerateIds: false })` 将 skeleton 转换为完整元素。

**禁止手动设置 text 元素的 width/height**：
- `convertToExcalidrawElements` 会自动计算正确的文字尺寸
- 手动写 width/height 会导致文字截断或 hit-test 崩溃
- `updateScene` 不会触发 Excalidraw 内部的 `autoResize`

**容器自动适配（boundElements）**：
- text 元素加 `boundElements: [{ "id": "框id", "type": "rectangle" }]` 后，容器会自动撑大到 `text宽高 + 48px padding`
- 文字自动居中到容器内
- 支持 rectangle、ellipse、diamond 三种容器
- 不加 boundElements 的纯文字/纯框不受影响

### ⚠️ Canvas 画布背景

Excalidraw workspace 容器设置了 `backgroundColor: rgba(0, 0, 0, 0.75)` 半透明黑底，保证白色文字和彩色元素的可读性，同时不完全遮挡背后的 GIF 角色。可调范围 0（全透明）~ 1（纯黑）。

### ⚠️ Canvas 通信机制（CustomEvent，非 StorageEvent）

Main process（launcher.js）通过 `executeJavaScript` 向 renderer 发送 `CustomEvent('cloe-bridge')` 来切换模式，React 端监听此事件。

**为什么不用 StorageEvent**：`StorageEvent` 在同源页面间通信时会触发复杂的 React 状态链路，已证实导致 renderer 崩溃（闪退只留 devtools 空壳）。

### ⚠️ executeJavaScript 限制（launcher.js）

1. **禁止嵌套模板字符串**：`` `(() => { return `${var}` })()` `` 会导致 Node.js 解析崩溃。用 `['code', 'part'].join('')` 代替。
2. **必须有 timeout 兜底**：executeJavaScript 的 Promise 可能永远不 resolve，必须设 setTimeout（~3s）防止 HTTP 请求挂起。
3. **每次修改 launcher.js 后必须重启 Electron**（不是 Vite HMR 管的，launcher.js 是 main process）。

## 注意事项

- 动作间隔至少 3-5 秒，太快会被打断
- `clients=0` 时动作不生效
- `action-sets.json` 和 `plugin-rules.json` 支持热加载（rules 有 5 秒 TTL 缓存）
- **plugin.yaml 的 hooks 不支持热加载**：修改后必须重启 Hermes gateway 进程
- **Canvas 模式需要 launcher.js + CanvasMode.jsx 配合**：改了 launcher.js 要重启 Electron，改了 JSX 文件 Vite HMR 自动生效
