# 提醒系统 API

通过 Bridge API 创建和管理定时提醒（喝水、番茄钟、自定义周期/倒计时）。

## 数据模型

```json
{
  "id": "喝水",
  "name": "喝水",
  "mode": "interval",          // interval=周期, countdown=番茄钟
  "duration": 1800,            // 秒数
  "enabled": true,
  "auto_start": true,          // dismiss后自动开始下一轮
  "tts": true,                 // 触发时播放语音
  "action": "wave",            // 触发时角色动作（空字符串=无动作）
  "break_duration": 0,         // countdown休息时长（秒）
  "total_rounds": 0,           // countdown总轮数（0=无限）
  "status": "running",         // idle/running/triggered/paused/completed
  "round": 0,
  "phase": "work",             // work/break（countdown模式）
  "trigger_at": "2026-07-14T12:00:00.000Z"
}
```

## API 端点

### 列出所有提醒

```bash
curl -s http://localhost:19851/reminders
```

### 创建提醒

```bash
# 周期提醒：每30分钟喝水，触发时挥手+语音
curl -s -X POST http://localhost:19851/reminders -H 'Content-Type: application/json' \
  -d '{"name":"喝水","mode":"interval","duration":1800,"action":"wave"}'

# 番茄钟：25分钟工作+5分钟休息，4轮，触发时鼓掌+语音
curl -s -X POST http://localhost:19851/reminders -H 'Content-Type: application/json' \
  -d '{"name":"专注","mode":"countdown","duration":1500,"break_duration":300,"total_rounds":4,"action":"clap","auto_start":true}'

# 倒计时：15分钟后一次性提醒
curl -s -X POST http://localhost:19851/reminders -H 'Content-Type: application/json' \
  -d '{"name":"该开会了","mode":"countdown","duration":900,"auto_start":false}'
```

### 更新提醒（改时间并重新计时）

```bash
# 把"喝水"改成每15分钟，start:true 立即重新开始计时
curl -s -X POST http://localhost:19851/reminders -H 'Content-Type: application/json' \
  -d '{"id":"喝水","name":"喝水","mode":"interval","duration":900,"start":true,"action":"wave"}'
```

### 控制提醒状态

```bash
# 清除当前触发（auto_start=true则开始下一轮，false则变idle）
curl -s -X POST http://localhost:19851/reminders/喝水/dismiss

# 停止并禁用
curl -s -X POST http://localhost:19851/reminders/喝水/stop

# 启用/禁用切换
curl -s -X POST http://localhost:19851/reminders/喝水/toggle

# 暂停（记录剩余时间）
curl -s -X POST http://localhost:19851/reminders/喝水/pause

# 恢复（用剩余时间继续）
curl -s -X POST http://localhost:19851/reminders/喝水/resume
```

### 删除提醒

```bash
curl -s -X DELETE http://localhost:19851/reminders/喝水
```

## 触发效果

提醒到时间时：
1. 桌面弹出毛玻璃卡片（角色正下方），显示提醒名称+操作按钮
2. 角色播放 `action` 指定的动作 GIF
3. 如果 `tts=true`，用 MOSI TTS 生成语音并播放：
   - 工作 phase：`{name}时间到啦`
   - 休息 phase：`休息时间到啦，放松一下吧`
   - 全部完成：`{name}全部完成啦，辛苦了`

## 注意事项

- `duration` 单位是**秒**（不是分钟）
- `id` 不传时自动从 name 生成（中文会保留）
- interval 模式 `auto_start` 默认 true，countdown 默认 false
- 番茄钟 dismiss 后自动切换 work↔break 相位，`total_rounds` 完成后自动标记 completed
- 提醒数据持久化在 `~/.cloe/reminders.json`，应用重启后自动恢复
- 中文提醒名在 URL 里需要 `encodeURIComponent` 编码
