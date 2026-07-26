---
name: cloe-desktop-action
description: "Cloe Desktop 桌面角色伴侣使用指南——动作触发、TTS语音、Canvas画布、嵌入终端、特效、GIF生成"
---

# Cloe Desktop 使用指南

Cloe Desktop 是基于 Electron + xterm.js + Excalidraw 的桌面角色伴侣，通过 HTTP bridge API 控制角色动作、语音、画布和嵌入终端。

## 前置条件

```bash
curl -s http://localhost:19851/status
# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
```

## 模块索引

| 文件 | 说明 |
|------|------|
| [references/action.md](references/action.md) | 动作触发、TTS语音、GIF生成、截图 |
| [references/layout.md](references/layout.md) | 角色位置 + 大小控制（挪动、缩放） |
| [references/canvas.md](references/canvas.md) | Excalidraw 画布绘制 API |
| [references/terminal.md](references/terminal.md) | 嵌入终端、模式切换、快捷键 |
| [references/plugin.md](references/plugin.md) | Hermes Plugin 自动触发规则 |
| [references/reminders-api.md](references/reminders-api.md) | 提醒系统 API（周期提醒、番茄钟、全局静音/暂停） |
| [references/agent-sessions-api.md](references/agent-sessions-api.md) | Agent Session Tracker API（外部 agent 注册、状态通知、TTS） |
| [references/tasks-api.md](references/tasks-api.md) | 任务管理 API（任务列表、计时、完成、排序） |
| [references/weather-api.md](references/weather-api.md) | 天气系统 API（配置 provider、预览天气特效） |
| [references/tts-api.md](references/tts-api.md) | TTS 语音 API（条件延迟播放、音频文件服务） |
| [references/config-api.md](references/config-api.md) | 配置 API（api-config、窗口位置/缩放、plugin-rules） |

## 快速参考

```bash
# 发现可用动作
curl -s http://localhost:19851/actions

# 触发动作
curl -s http://localhost:19851/action -d '{"action":"wave"}'

# TTS 语音（推荐）
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py --text "你好" --speak

# 画布：显示/隐藏
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"canvas"}'
curl -s -X POST http://localhost:19851/canvas/hide

# 画布：绘制元素
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw -H 'Content-Type: application/json' -d '{"elements":[...]}'

# 画布：读取/清除
curl -s http://localhost:19851/canvas/excalidraw/scene
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/scene

# 角色布局：获取/设置位置和大小
curl -s http://localhost:19851/character-layout
curl -s -X POST http://localhost:19851/character-layout -H 'Content-Type: application/json' \
  -d '{"position":{"x":0.7,"y":1},"size":{"scale":1.2}}'

# 提醒系统：创建周期提醒
curl -s -X POST http://localhost:19851/reminders -H 'Content-Type: application/json' \
  -d '{"name":"喝水","mode":"interval","duration":1800,"action":"wave"}'

# 全局静音 toggle
curl -s -X POST http://localhost:19851/toggle-mute

# 全局暂停/恢复提醒 toggle
curl -s -X POST http://localhost:19851/toggle-global-pause

# 任务管理：创建任务 + 开始计时
curl -s -X POST http://localhost:19851/tasks -H 'Content-Type: application/json' -d '{"title":"写文档"}'
curl -s -X POST http://localhost:19851/tasks/TASK_ID/start

# 天气：启用（open-meteo 免 key）+ 预览下雨效果
curl -s -X POST http://localhost:19851/weather/config -H 'Content-Type: application/json' -d '{"enabled":true,"provider":"open-meteo","city":"auto"}'
curl -s -X POST http://localhost:19851/weather/preview -H 'Content-Type: application/json' -d '{"weatherType":"rain"}'

# Agent Session：注册外部 agent session
curl -s -X POST http://localhost:19851/agent-sessions -H 'Content-Type: application/json' \
  -d '{"source":"zcode","source_label":"ZCode","title":"Running tests"}'

# Agent Session：通知 turn 完成（触发 TTS）
curl -s -X POST http://localhost:19851/agent-sessions/SESSION_ID/turn-end -H 'Content-Type: application/json' -d '{}'

# Agent Session：通知需要用户确认（触发 TTS）
curl -s -X POST http://localhost:19851/agent-sessions/SESSION_ID/needs-decision -H 'Content-Type: application/json' -d '{}'
```

## 项目位置

- 本地：`~/work/cloe-desktop`
- GitHub：https://github.com/JakimLi/cloe-desktop
