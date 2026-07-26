# TTS 语音 API

涵盖三类 TTS 相关能力：条件 TTS 调度（延迟播放 + 用户确认取消）、TTS 音频文件服务、以及与 `generate_tts.py` 脚本的配合。

> 角色直接说话的推荐方式是用 `generate_tts.py --speak`（见 [action.md](action.md)），它会生成音频并通过 `/action` speak 触发。本文档讲的是底层的调度配置和音频文件托管。

## 一、条件 TTS 调度

提醒（reminders）和 agent session 在触发 TTS 时，不会立刻播放，而是**延迟一个窗口**（默认 3 秒）。在这个窗口内，如果用户有交互（比如打开了相关面板），TTS 会被取消——避免重复打扰。

### 配置数据模型

```json
{
  "conditional_tts": true,
  "tts_delay": 3000
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `conditional_tts` | bool | 是否启用条件延迟。`false` 时所有 TTS 立即播放（无延迟、不可取消） |
| `tts_delay` | number | 延迟毫秒数（默认 3000） |

### 读取配置

```bash
curl -s http://localhost:19851/tts-scheduler/config
```

### 更新配置

```bash
# 关闭条件延迟，所有 TTS 立即播放
curl -s -X POST http://localhost:19851/tts-scheduler/config -H 'Content-Type: application/json' \
  -d '{"conditional_tts":false}'

# 改成延迟 5 秒
curl -s -X POST http://localhost:19851/tts-scheduler/config -H 'Content-Type: application/json' \
  -d '{"tts_delay":5000}'
```

### 取消待播 TTS

取消还在延迟窗口内、尚未播放的 TTS。

```bash
# 取消指定来源（sourceKey 形如 "reminder:喝水" 或 "agent:sessionId:turn-end"）
curl -s -X POST http://localhost:19851/tts-scheduler/cancel -H 'Content-Type: application/json' \
  -d '{"sourceKey":"reminder:喝水"}'

# 按来源类型 + id 取消（取消某个 reminder 的）
curl -s -X POST http://localhost:19851/tts-scheduler/cancel -H 'Content-Type: application/json' \
  -d '{"source":"reminder","id":"喝水"}'

# 取消所有待播
curl -s -X POST http://localhost:19851/tts-scheduler/cancel -H 'Content-Type: application/json' \
  -d '{"sourceKey":"*"}'
```

| 参数 | 说明 |
|------|------|
| `sourceKey` | 完整的来源 key，传 `"*"` 取消全部 |
| `source` + `id` | 备选方式：`source` 是 `'reminder'`/`'agent'`，`id` 是对应 id |

> 注意：`cancel` 只取消**尚未播放**的（在延迟窗口内）。已经开始播放的无法取消。

## 二、TTS 音频文件服务

`generate_tts.py` 生成的音频会写到 `~/.cloe/audio_cache/`，然后通过 `/tts/:filename` 这个 HTTP 端点暴露，供角色的 speak 动作播放（Chromium 需要通过 HTTP URL 加载音频，且要求支持 Range 请求）。

### 读取生成的音频

```bash
# 流式返回音频，支持 Range（206 Partial Content）
curl -s http://localhost:19851/tts/你好_1719400000000.mp3 --output voice.mp3
```

支持的格式：`.mp3`、`.wav`、`.opus`、`.ogg`。文件名来自 `generate_tts.py` 的 `--output`，通常形如 `<text>_<timestamp>.<ext>`。

### 内置兜底音频

应用自带两个预录音频，用于 agent session 在 TTS 失败时的兜底：

```bash
# 对话回合结束的提示音
curl -s http://localhost:19851/tts-fallback/turn_complete.mp3 --output turn.mp3

# 需要用户决策的提示音
curl -s http://localhost:19851/tts-fallback/needs_decision.mp3 --output decide.mp3
```

## 三、与 generate_tts.py 的配合

完整的"让角色说话"链路（详见 [action.md](action.md)）：

```bash
# 1. 生成音频（会写入 ~/.cloe/audio_cache/ 并返回文件名）
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "你好，我是 Cloe"

# 2. 用返回的文件名触发 speak（audio_url 指向 /tts/ 端点）
curl -s -X POST http://localhost:19851/action -H 'Content-Type: application/json' \
  -d '{"action":"speak","audio":"你好_1719400000000.mp3"}'
```

`--speak` 参数会自动完成上面两步。

## 注意事项

- 配置持久化在 `~/.cloe/tts-scheduler.json`
- `conditional_tts` 主要影响 reminders 和 agent-sessions 的 TTS；`generate_tts.py --speak` 触发的是即时 speak，不经过调度
- `/tts/:filename` 和 `/tts-fallback/:filename` 都禁止路径穿越（filename 不能含 `/`、`..`、null 字节）
- 客户端通过 WebSocket 收到 `tts-scheduled`（TTS 排入延迟队列）、`tts-cancelled`（被取消）、`tts-played`（已播放）消息
