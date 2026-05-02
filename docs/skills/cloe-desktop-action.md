---
name: cloe-desktop-action
description: 通过 HTTP API 动态发现和触发 Cloe 桌面角色的表情动作动画
---

# Cloe Desktop Action — 桌面动画触发

## 架构

```
Hermes / 任何 HTTP 客户端
  → Bridge HTTP API (:19851)
    → WebSocket (:19850)
      → Electron renderer
        → 双缓冲 GIF 交叉淡入淡出
```

Bridge 内嵌在 Electron main process 的 `launcher.js` 中，WS + HTTP 同进程运行，无外部依赖。

## 前置条件

Cloe Desktop 必须在运行（dev 模式或 Cloe.app 均可）：

```bash
curl -s http://localhost:19851/status
# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
```

`clients=1` 表示 Electron 渲染进程已连接。`clients=0` 时触发动作不会报错但不会生效。

## 动态发现可用动作（重要）

**不要硬编码动作列表。** 新动作可以通过管理界面随时生成，通过 API 实时获取：

```bash
# 获取当前激活动作集的所有动作
curl -s http://localhost:19851/actions

# 获取所有动作集（含名称、动作数量、是否激活）
curl -s http://localhost:19851/action-sets

# 获取指定动作集的详情
curl -s http://localhost:19851/action-sets/default

# 获取指定动作集的动作列表
curl -s http://localhost:19851/actions?set=default
```

### API 响应格式

`GET /actions` 返回：

```json
{
  "activeSetId": "default",
  "actions": [
    {
      "name": "smile",
      "gifFile": "smile.gif",
      "gifPath": "gifs/smile.gif",
      "trigger": "idle",
      "idleWeight": 2,
      "hookNames": ["smile", "approve", "happy"],
      "special": null,
      "description": "微笑，用于开心、赞同、被夸的时候",
      "descriptionEn": "Smile — happiness, agreement, being praised"
    }
  ]
}
```

**字段含义：**

| 字段 | 说明 |
|------|------|
| `name` | 动作唯一标识，用于触发 |
| `description` | 中文语义描述——动作的含义和适用场景，用于选择动作 |
| `descriptionEn` | 英文语义描述 |
| `trigger` | 触发方式：`idle`（自动轮播）/ `hook`（手动触发）/ `manual`（系统内部，如 working） |
| `idleWeight` | idle 循环中的权重（0 表示不参与 idle） |
| `hookNames` | **可用触发名列表**——这些都可以作为 action 参数传入 |
| `special` | 特殊功能标记：`"语音"` 表示支持 TTS，`"工作模式"` 表示系统锁定状态 |

### 如何选择动作

1. **查询 API** `GET /actions` 获取动作列表和描述
2. **根据 `description` 匹配语境**——每个动作都有语义描述说明含义和适用场景
3. 用 `name` 或 `hookNames` 中的任意一个作为触发参数
4. `hookNames` 是别名扩展：比如 smile 的 hookNames 是 `["smile", "approve", "happy"]`，传任何一个都能触发微笑

## 触发动作

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

`<ACTION_NAME>` 使用上一步查到的 `name` 或 `hookNames` 中的任意值。

**行为：** 动作播放约 3 秒后自动恢复 idle 循环。working 模式下 reaction 播完后回到 working。

## 语音动作（speak）

带 `special: "语音"` 标记的动作支持三种语音播放方式。

### 方式一：预录语音（`audio` 字段）

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
```

预录文件存放在 `public/audio/` 目录。添加新语音：
1. 用 TTS 生成 wav
2. `ffmpeg -i input.wav -c:a libmp3lame -q:a 4 public/audio/xxx.mp3`
3. 触发：`{"action":"speak","audio":"xxx"}`

### 方式二：动态音频 URL（`audio_url` 字段）

传一个音频 URL（data URL 或 HTTP URL），桌面角色边说话边播语音：

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:18999/cloe_tts.wav"}'
```

- 支持格式：`data:audio/wav;base64,...`、`data:audio/mp3;base64,...`、`http(s)://...`
- **Data URL 限制**：curl 命令行参数上限约 128KB，超过约 5 秒音频 base64 会超限。长文本用 HTTP URL。
- **播放时长**：`audio_url` 模式等音频播完才回 idle（不受 3 秒 reaction 限制）。`audio` 预录模式仍走 3 秒固定 timer。
- 优先级：`audio_url` > `audio`

### 方式三：本地流式 TTS（`text` 字段）

需要本地 TTS server 运行（端口 19853）。renderer 直连 TTS WebSocket 接收 PCM 流播放：

```bash
# 前置：启动 TTS server
cd ~/work/MOSS-TTS-Nano && source venv/bin/activate && python tts_server.py --port 19852

# 触发
curl -s http://localhost:19851/action -d '{"action":"speak","text":"你好呀，小可爱！"}'
```

Intel Mac 生成比约 10:1（1 秒音频需约 10 秒生成），当前策略是缓冲完再播。M1 芯片后可改为边生成边播。

**TTS 文本格式**：用完整连贯句子，少用省略号/波浪号/感叹号。标点当停顿会导致断断续续。

## 系统动作

部分动作由系统自动触发，不需要手动调用：

| 动作 | 触发方式 | 说明 |
|------|---------|------|
| `working` | Gateway hook `agent:start` | 敲键盘 GIF，锁定工作模式 |
| `idle` | Gateway hook `agent:end` | 恢复 idle 随机循环 |
| `wave` | Gateway hook `session:start` | 新会话打招呼 |
| `kiss` | Gateway hook `session:end` | 会话结束 |

### Idle 待机循环

无 action 触发时，Electron 自动按权重随机播放 `trigger: "idle"` 的动作。
每 8~15 秒切换一次，不连续重复。可通过 `idleWeight` 控制频率。

## 使用示例

```bash
# 先查可用动作
curl -s http://localhost:19851/actions

# 开心 → 从 hookNames 中选
curl -s http://localhost:19851/action -d '{"action":"happy"}'

# 思考
curl -s http://localhost:19851/action -d '{"action":"think"}'

# 说话 + TTS
curl -s http://localhost:19851/action -d '{"action":"speak","text":"想你了"}'
```

## 多动作集

支持多套角色形象（如默认、校服、家居等），通过管理界面切换。切换后 `GET /actions` 返回新动作集的内容，**无需任何代码变更**。

- `GET /action-sets` — 列出所有动作集
- `GET /action-sets/:id` — 查看指定集详情
- 切换后桌面自动使用新 GIF，API 自动返回新动作列表

## 注意事项

- 动作之间间隔至少 3-5 秒，太快会被下一个打断（3 秒 reaction duration）
- `clients=0` 时 curl 不报错但动作不生效
- 非默认动作集的 GIF 存放在 `gifs/{setId}/` 子目录，API 返回的 `gifPath` 已包含正确路径
- `action-sets.json` 支持热重载（fs.watch + 防抖），外部写入后桌面自动更新
