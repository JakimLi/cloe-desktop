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

链路：TTS 生成音频 → 保存到 `~/.cloe/audio_cache/` → bridge `/tts/` 路由 serve → speak 播放。

#### 配置 TTS Provider

配置文件：`~/.cloe/tts-config.json`（**唯一的 TTS 配置来源**）

```json
{
  "provider": "mosi",
  "mosi": {
    "api_key": "***",
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

**MOSI 音色**（改 `voice_id`）：`2036257587296473088` — 陈可可（默认）

**CosyVoice 音色**（改 `voice`）：`longmiao`（可爱）、`loongstella`（年轻）、`loongbella`（甜美）、`longyue`（温柔）

#### 生成 + 播放步骤

1. **生成音频**（用 terminal，SDK 依赖系统 Python）— 根据 `tts-config.json` 的 `provider` 自动选择引擎，输出到 `~/.cloe/audio_cache/tts_<timestamp>.wav`（mosi）或 `.mp3`（cosyvoice）
2. **WAV 转 MP3**（Electron 的 `new Audio()` 对 WAV 播放不完整，必须转）：`ffmpeg -y -i input.wav -c:a libmp3lame -q:a 4 output.mp3`
3. **触发 speak**：

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>.mp3"}'
```

**要点**：
- TTS 文本用完整连贯句子，少用省略号/波浪号
- MOSI 返回 JSON `{"audio_data":"<base64>"}`，需 `base64.b64decode()` 后写文件
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

> 修改 plugin 文件后需重启 Hermes gateway 才能生效。

## 生成新动作（GIF Pipeline）

Cloe 可以自己生成新动作！完整链路：参考图 → AI 视频 → chromakey → 透明 GIF。

脚本在 `scripts/` 目录下，数据目录统一为 `~/.cloe`。

### 单个动作生成

```bash
# 默认绿幕
python3 scripts/generate_gif_v2.py \
  --action <动作名> \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。" \
  --duration 5

# 蓝幕模式（对黑发更友好）
python3 scripts/generate_gif_v2.py \
  --action <动作名> \
  --prompt "..." \
  --chromakey blue
```

输出自动到 `~/.cloe/gifs/<动作名>.gif`。

### 批量生成（4路并行）

编辑 `scripts/batch_generate_gifs.py` 的 `ACTIONS` 字典后：

```bash
python3 scripts/batch_generate_gifs.py
```

### Prompt 写法要点

- **身体保持不动**：只描述头部/上半身微动作，避免大幅移动
- **纯色背景**：末尾必须加"纯绿色背景"或"纯蓝色背景"
- **电影质感，高清**：提高生成质量
- **时长**：一般 3-5 秒（idle 3 秒，表情 5 秒）

### 已知限制

- 每次生成耗时 ~3-5 分钟（百炼 API 异步轮询）
- 绿幕对黑发有轻微残留，蓝幕效果更好
- **必须用 terminal 执行**（PIL/numpy/scipy 依赖系统 Python），不要用 execute_code

## 注意事项

- 动作间隔至少 3-5 秒，太快会被打断
- `clients=0` 时动作不生效
- `action-sets.json` 和 `plugin-rules.json` 支持热加载（rules 有 5 秒 TTL 缓存）
- **plugin.yaml 的 hooks 不支持热加载**：修改后必须重启 Hermes gateway 进程
