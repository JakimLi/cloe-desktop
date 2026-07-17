# Terminal 助手感知通知（TTS 语音）

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 为 Cloe Desktop 提供一个通用的 TTS 语音通知 API（`POST /notify`），以及内置的 PTY 退出检测。外部工具（Claude Code hooks、CI 脚本、任何能 curl 的东西）可以自行配置来调用这个 API。

**Architecture:** 两个独立模块——① HTTP API（`/notify` 接收 text，异步调 TTS）② PTY 退出检测（shell 自然退出时自动通知，排除用户主动关闭）。两者通过同一个 `/notify` endpoint 汇合。

**Tech Stack:** Electron HTTP bridge、node-pty onExit、`generate_tts.py --speak`。

---

## 模块关系

```
┌─────────────────────────────────────┐
│         POST /notify (API)          │  ← 任何人都可以调
│  text → generate_tts.py --speak     │
│  → Cloe 桌面 TTS + speak 动作        │
└─────────────────────────────────────┘
         ▲                    ▲
         │                    │
    ┌────┴────┐         ┌────┴────┐
    │ 外部工具 │         │  我们自己 │
    │ claude   │         │ PTY 退出  │
    │ code     │         │ 检测     │
    │ hooks    │         │          │
    │ CI 脚本   │         │          │
    └─────────┘         └─────────┘
```

**我们只实现右半边 + API。左半边是用户/工具自行配置的。**

---

## Task 1: `POST /notify` — 通用 TTS 通知 API

**Objective:** launcher.js 新增 `/notify` endpoint，接收 `{text}`，异步调 `generate_tts.py --speak`，立即 202 返回

**Files:**
- Modify: `launcher.js`（HTTP server 路由区，`/action` 附近）

**Step 1: 添加路由**

在 `handleActionPost` 附近添加：

```js
// POST /notify — 通用 TTS 语音通知
// 任何人/工具都可以调：claude code hooks、CI 脚本、内部 PTY 检测等
// 异步执行：立即返回 202，TTS 在后台生成播放
if (req.method === 'POST' && urlPath === '/notify') {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    try {
      const { text } = JSON.parse(body || '{}');
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing or empty text field' }));
        return;
      }

      const ttsScript = path.join(
        os.homedir(), '.hermes', 'skills', 'creative',
        'cloe-desktop-action', 'scripts', 'generate_tts.py'
      );

      // 异步 spawn，不阻塞响应
      const child = spawn('python3', [ttsScript, '--text', text.trim(), '--speak'], {
        env: { ...process.env, HOME: os.homedir() },
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, text: text.trim() }));
      console.log(`[Notify] TTS queued: "${text.trim().substring(0, 50)}"`);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  return;
}
```

**Step 2: 验证**

```bash
# Cloe Desktop 运行时
curl -X POST http://localhost:19851/notify \
  -H "Content-Type: application/json" \
  -d '{"text":"测试通知"}'
# 预期: 202 + Cloe 开口说"测试通知"
```

**Step 3: Commit**

```bash
git add launcher.js
git commit -m "feat: add POST /notify — generic TTS notification API"
```

---

## Task 2: PTY 退出检测 → 自动通知

**Objective:** 当 terminal tab 中的 shell 自然退出时（非用户主动关闭），通过 IPC 通知 renderer，renderer 调用 `/notify` 触发 TTS

**Files:**
- Modify: `launcher.js:2516-2571`（spawnPty + pty-kill handler）
- Modify: `preload.js`（新增 `onPtyExit`）

### Step 1: launcher.js — 区分 kill vs 自然退出 + IPC 转发

在 `ptyMap` 旁添加 kill 标记集合：

```js
const ptyMap = new Map();
const ptyKillSet = new Set();  // 主动 kill 的 ptyId，退出时不通知
```

修改 `pty-kill` handler，kill 前标记：

```js
ipcMain.on('pty-kill', (_e, { ptyId }) => {
  const p = ptyMap.get(ptyId);
  if (p) {
    ptyKillSet.add(ptyId);
    p.kill();
    ptyMap.delete(ptyId);
    console.log(`[PTY:${ptyId}] Killed`);
  }
});
```

修改 `spawnPty` 的 `onExit`，自然退出时发 IPC：

```js
ptyProc.onExit(({ exitCode }) => {
  console.log(`[PTY:${ptyId}] Shell exited with code ${exitCode}`);
  const wasKilled = ptyKillSet.has(ptyId);
  ptyKillSet.delete(ptyId);
  ptyMap.delete(ptyId);

  if (!wasKilled && win && !win.isDestroyed()) {
    win.webContents.send('pty-exit', { ptyId, exitCode });
  }
});
```

### Step 2: preload.js — 暴露 `onPtyExit`

在 `electronAPI` 对象中添加：

```js
onPtyExit: (cb) => ipcRenderer.on('pty-exit', (_e, { ptyId, exitCode }) => cb(ptyId, exitCode)),
```

### Step 3: renderer.js — 监听 PTY 退出 + 调用 `/notify`

```js
// ==================== PTY Exit Notification ====================
window.addEventListener('DOMContentLoaded', () => {
  if (!window.electronAPI?.onPtyExit) return;

  window.electronAPI.onPtyExit((ptyId, exitCode) => {
    const text = exitCode === 0
      ? '终端任务完成了哦~'
      : '终端任务好像出错了，你看看吧';
    fetch('http://localhost:19851/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(e => console.error('[Notify] PTY exit notify failed:', e));
  });
});
```

### Step 4: 验证

| 操作 | 预期 |
|------|------|
| 终端输入 `exit` | 可可说"终端任务完成了哦~" |
| `Cmd+W` 关闭 tab | **不通知** |
| 运行 `exit 1` | 可可说"好像出错了" |

### Step 5: Commit

```bash
git add launcher.js preload.js src/renderer.js
git commit -m "feat: PTY exit detection triggers TTS notification (skip user kills)"
```

---

## Task 3: 通知防抖

**Objective:** 3 秒内多次触发只播一次，避免语音叠加

**Files:**
- Modify: `launcher.js`（`/notify` handler）

**Step 1: 添加全局 debounce**

在 `/notify` handler 开头：

```js
let lastNotifyTime = 0;
const NOTIFY_DEBOUNCE_MS = 3000;

// 在 handler 中，parse 完 text 之后：
const now = Date.now();
if (now - lastNotifyTime < NOTIFY_DEBOUNCE_MS) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, skipped: true }));
  return;
}
lastNotifyTime = now;
```

**Step 2: Commit**

```bash
git add launcher.js
git commit -m "feat: 3s debounce on /notify to prevent voice overlap"
```

---

## API 文档（附在 plan 里，后续可写入 cloe-desktop-action skill）

```
POST /notify
Content-Type: application/json

Body: { "text": "要说的话" }

Response:
  202 { "ok": true, "text": "要说的话" }  — TTS 已排队
  200 { "ok": true, "skipped": true }     — 被 debounce 跳过
  400 { "error": "..." }                  — 参数错误

行为:
  异步调用 generate_tts.py --text "..." --speak
  生成 MP3 → 保存 audio_cache → POST /action { action:'speak', audio_url }
  Cloe 桌面播放语音 + speak 动作
```

**用户/工具自行配置示例：**

Claude Code `~/.claude/settings.json`：
```json
{
  "hooks": {
    "Stop": [{
      "type": "command",
      "command": "curl -s -X POST http://localhost:19851/notify -H 'Content-Type: application/json' -d '{\"text\":\"Claude 完成了\"}'"
    }]
  }
}
```

任何 shell 脚本：
```bash
npm run build && curl -s -X POST localhost:19851/notify -d '{"text":"构建完成了"}'
```

## 验证清单

| # | 场景 | 预期 |
|---|---|---|
| 1 | `curl POST /notify {"text":"test"}` | 可可说"test" |
| 2 | 终端 `exit` | 可可说"终端任务完成了哦~" |
| 3 | 终端 `exit 1` | 可可说"好像出错了" |
| 4 | `Cmd+W` 关 tab | 不通知 |
| 5 | 3 秒内连续 POST /notify | 只播一次 |
| 6 | Cloe Desktop 未启动 | curl 失败，调用方自行处理 |
