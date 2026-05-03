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

## Android 全量拉取 GIF 相关接口（关键）

Android 的“从 PC 拉取动作（GIF）”依赖下面这组接口：

```bash
GET /action-sets
GET /action-sets/:id
GET /action-sets/:id/actions/:name/gif
```

如果最后这个 GIF 下载接口不存在，安卓端会在逐个动作下载时报 `404`，提示“下载失败”。

### 路由顺序坑（Node HTTP 手写路由常见）

如果先匹配宽泛路由（例如 `GET /action-sets/:id` 用 `startsWith('/action-sets/')`），会把 `.../actions/.../gif` 误吞，导致本应命中的 GIF 路由永远到不了。

正确做法：
1. 先匹配更具体的 `GET /action-sets/:id/actions/:name/gif`
2. 再匹配 `GET /action-sets/:id`
3. `:id` 路由用精确正则（如 `^/action-sets/[^/]+$`），避免子路径误命中

## 触发动作

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

动作播放约 3 秒后自动恢复 idle 循环。

## 语音动作（speak）

### 方式一：TTS 动态语音（推荐）

链路：TTS 生成音频 → 保存到 `~/.cloe/audio_cache/` → bridge `/tts/` 路由 serve → speak 播放。

#### 配置 TTS Provider

配置文件：`~/.cloe/tts-config.json`

```json
{
  "provider": "mosi",
  "mosi": {
    "api_key": "...",
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
- `"mosi"` — MOSI 云端 TTS（可可音色，快 ~3s，有审核）**← 默认**
- `"cosyvoice"` — 阿里云 CosyVoice（多音色可选）

**MOSI 音色**（改 `voice_id`）：
- `2036257587296473088` — 陈可可（默认）
- `2042261353581776896` — 陈可可（备用）

**CosyVoice 音色**（改 `voice`）：
- `longmiao`（可爱）、`loongstella`（年轻）、`loongbella`（甜美）、`longyue`（温柔）、`longjing`（清亮）

#### 生成 + 播放

**步骤 1：生成音频**（必须用 terminal，SDK 只在系统 Python）

根据 `~/.cloe/tts-config.json` 的 `provider` 字段自动选择 TTS 引擎生成音频，保存到 `~/.cloe/audio_cache/tts_<timestamp>.wav`（mosi）或 `.mp3`（cosyvoice）。输出文件名到 stdout。

**MOSI TTS 调用方式**：POST `https://studio.mosi.cn/v1/audio/tts`，body: `{"model":"moss-tts","text":"...","voice_id":"2036257587296473088","sampling_params":{"temperature":1.7,"top_p":0.8,"top_k":25}}`，header: `Authorization: Bearer <api_key>`，返回 wav 二进制。

**CosyVoice TTS 调用方式**：dashscope SDK `SpeechSynthesizer(model="cosyvoice-v1", voice="longmiao")`，API key 从 `BAILIAN_API_KEY` 读取。

**步骤 2：触发 speak**

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>"}'
```

- Bridge `GET /tts/:filename` serve `~/.cloe/audio_cache/`
- Renderer 等音频播完才回 idle（不受 3 秒限制）
- **TTS 文本格式**：完整连贯句子，少用省略号/波浪号/感叹号
- **打包后首次测试 /tts/ 路由必须 404 先排查**：如果刚 `./scripts/install.sh` 完，bridge 可能还没完全就绪（status 返回 clients=1 但 HTTP handler 还没注册完）。等 3-4 秒再测。如果持续 404，说明 Cloe.app 是旧版本没包含 `/tts/` 路由——必须重新 `./scripts/pack.sh --dir && ./scripts/install.sh`
- **WAV 音频在 Electron new Audio() 会提前结束/不完整播放**：必须用 ffmpeg 转 MP3 后再触发 speak。`ffmpeg -y -i input.wav -c:a libmp3lame -q:a 4 output.mp3`
- **MOSI TTS 返回 JSON 不是纯 WAV**：格式为 `{"audio_data": "<base64>"}`，需要 `resp.json()` → `base64.b64decode()` → 写文件，不能直接 `resp.content` 写文件

### speak 优先级（isSpeaking 锁）

renderer.js 有 `isSpeaking` 最高优先级锁——TTS 音频播放期间：
- **所有其他 action 被 drop**（working、idle、nod 等全部忽略）
- 唯一例外是另一个 `speak`（可覆盖）
- 音频播完（`ended` 事件）自动解锁，恢复 idle 循环
- plugin hooks（post_llm_call → idle）不会打断 TTS 播放

### 生成 + 触发完整脚本（MOSI）

```python
import json, base64, requests, os, time
config = json.load(open(os.path.expanduser('~/.cloe/tts-config.json')))
mosi = config['mosi']
resp = requests.post(mosi['url'], json={
    'model': 'moss-tts', 'text': '要说的话',
    'voice_id': mosi['voice_id'],
    'sampling_params': {'temperature': 1.7, 'top_p': 0.8, 'top_k': 25}
}, headers={'Authorization': f'Bearer {mosi["api_key"]}'}, timeout=30)
audio_bytes = base64.b64decode(resp.json()['audio_data'])
ts = int(time.time())
wav_path = os.path.expanduser(f'~/.cloe/audio_cache/tts_{ts}.wav')
with open(wav_path, 'wb') as f: f.write(audio_bytes)
print(wav_path)  # 下一步 ffmpeg 转 mp3
```

然后：
```bash
ffmpeg -y -i ~/.cloe/audio_cache/tts_<TS>.wav -c:a libmp3lame -q:a 4 ~/.cloe/audio_cache/tts_<TS>.mp3
curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/tts_<TS>.mp3"}'
```

### 方式二：预录语音（`audio` 字段）

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
```

走 3 秒固定 timer。添加新语音：TTS 生成 → `ffmpeg` 转 mp3 → 放 `public/audio/`

### 方式三：data URL（短音频，<5s）

base64 编码后传 `data:audio/mpeg;base64,...`，curl 上限约 128KB。

## 系统动作

| 动作 | 触发方式 | 说明 |
|------|---------|------|
| `working` | hook agent:start | 敲键盘，锁定工作模式 |
| `idle` | hook agent:end | 恢复 idle 循环 |
| `wave` | hook session:start | 新会话打招呼 |
| `kiss` | hook session:end | 会话结束 |

## Hermes Plugin（自动触发）

`~/.hermes/plugins/cloe-desktop/` 监听生命周期事件自动触发表情。

### 触发规则（plugin-rules.json）

存在 `~/.cloe/plugin-rules.json`，5 秒缓存自动刷新。

```json
{
  "min_interval": 1.5,
  "tool_expressions": {"terminal": "think", "execute_code": "think", "read_file": null},
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

## 生成新动作（GIF Pipeline）

Cloe 可以自己生成新动作！完整链路：参考图 → AI 视频 → chromakey → 透明 GIF。

### 方式一：通过管理界面 API（推荐，全自动）

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

# 查看所有任务
curl -s http://localhost:19851/generation-tasks
```

**自动完成的事情**：生成 GIF → 更新 action-sets.json（animations + actionMap） → 广播到 renderer。
**不需要手动改代码**，但 renderer.js 的硬编码 GIF_ANIMATIONS 可能需要同步（双轨机制）。

### 方式二：手动跑脚本

```bash
cd ~/work/cloe-desktop

# 单个动作生成（绿幕默认）
python3 scripts/generate_gif_v2.py \
  --action <动作名> \
  --prompt "<中文描述女孩的动作，末尾加'纯绿色背景。电影质感，高清。'>" \
  --duration 5

# 蓝幕模式（对黑发+白衣服更友好）
python3 scripts/generate_gif_v2.py \
  --action <动作名> \
  --prompt "..." \
  --chromakey blue \
  --reference reference_upperbody_bluebg.png

# 批量生成（4路并行）：编辑 scripts/batch_generate_gifs.py 的 ACTIONS 字典后
python3 scripts/batch_generate_gifs.py
```

- 输出自动到 `public/gifs/<动作名>.gif`
- 参考图已有：绿幕 `reference_upperbody_greenbg.png`、蓝幕 `reference_upperbody_bluebg.png`
- **不要用文生图重新生成参考图**（人物一致性会崩）

### 生成后需要更新的地方

**通过 API 生成（方式一）无需手动更新**——`mergeGenerateActionIntoSet()` 自动更新 action-sets.json 并 broadcast 到 renderer。

**通过脚本生成（方式二）需要手动更新 action-sets.json**：
```json
// animations 加一条
"<action>": "gifs/<action>.gif"

// actionInfo 加一条
"<action>": {
  "description": "中文描述",
  "descriptionEn": "English description"
}

// actionMap 加一条（如果需要外部触发名映射）
"<trigger>": "<action>"
```

**不需要改 renderer.js**。renderer 启动时用硬编码初始化，但 launcher 启动时会 broadcast `set-config` 消息，renderer 收到后直接覆盖 GIF_ANIMATIONS/ACTION_MAP/IDLE_PLAYLIST。运行时完全由 action-sets.json 驱动。这就是文件系统设计：写入 action-sets.json → app 自动读到。

**idlePlaylist**（可选，只有 idle 动作才加）：
```json
// 在 idlePlaylist 数组中添加动作名，重复出现增加权重
```

### 测试

```bash
# API 测试
curl -s http://localhost:19851/action -d '{"action":"<action>"}'

# 检查是否被识别（含 description）
curl -s http://localhost:19851/actions
# 在返回的 JSON 中查找动作名和 description 字段确认注册成功
```

### 生产模式生效

如果用的是 Cloe.app（打包版），必须重新打包：
```bash
cd ~/work/cloe-desktop
./scripts/pack.sh --dir && ./scripts/install.sh
```

### Prompt 写法要点

- **身体保持不动**：只描述头部/上半身的微动作，避免大幅身体移动（chromakey 会出错）
- **纯色背景**：末尾必须加"纯绿色背景"或"纯蓝色背景"
- **电影质感，高清**：提高生成质量
- **时长**：一般 3-5 秒（idle 动作 3 秒，表情动作 5 秒）
- **参考示例**：
  - `"她微微嘟起嘴唇，表情可爱委屈。身体保持不动。纯绿色背景。电影质感，高清。"` → pout
  - `"她轻轻叹了口气，表情无奈。身体保持不动。纯绿色背景。电影质感，高清。"` → sigh

### 已知限制

- 每次生成耗时 ~3-5 分钟（百炼 API 异步轮询）
- 绿幕对黑发有轻微残留，蓝幕效果更好
- `generate_gif.py`（v1）和 `generate_gif_v2.py` 功能类似，v2 支持蓝幕和自动压缩参考图
- 必须在 terminal 里跑 Python 脚本（PIL/numpy/scipy 依赖系统 Python），不要用 execute_code

## 注意事项

- 动作间隔至少 3-5 秒，太快会被打断
- `clients=0` 时动作不生效
- `action-sets.json` 和 `plugin-rules.json` 都支持热加载
- **打包后首次测试 /tts/ 路由必须 404 先排查**：刚 `./scripts/install.sh` 完 bridge 可能还没完全就绪（clients=1 但 HTTP handler 没注册完）。等 3-4 秒再测。持续 404 说明 Cloe.app 是旧版本，需重新 `./scripts/pack.sh --dir && ./scripts/install.sh`
