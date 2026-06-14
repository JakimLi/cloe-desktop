---
name: code-review
description: "Cloe Desktop 终端代码走查功能——逐段展示代码、bat 语法高亮、键盘导航、评论收集"
---

# Code Review — 终端代码走查

在 Cloe Desktop 的 Terminal 里逐段展示代码，用户可键盘导航、输入评论，走查结束后 agent 拉取评论并执行修复。

## 前置条件

```bash
curl -s http://localhost:19851/status
# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
```

## API

```
POST http://localhost:19851/terminal/walk
Content-Type: application/json
```

### action=start — 开始走查

```json
{
  "action": "start",
  "steps": [
    {
      "file": "/path/to/file.js",
      "start": 10,
      "end": 30,
      "title": "功能标题",
      "highlight": [12, 15],
      "note": "这段代码的作用说明"
    }
  ]
}
```

每个 step 用 bat 异步预渲染 ANSI 语法高亮，base64 编码传给前端渲染。

### action=next / prev — 切换代码段

```json
{"action": "next"}
{"action": "prev"}
```

### action=stop — 退出回到 shell

```json
{"action": "stop"}
```

### action=get-comments — 获取所有评论

走查结束后调用，拉取用户在终端里留下的评论：

```json
{"action": "get-comments"}
```

返回：

```json
{
  "ok": true,
  "comments": [
    {
      "stepIndex": 0,
      "stepTitle": "功能标题",
      "file": "/path/to/file.js",
      "lines": "10-30",
      "text": "这里有个bug",
      "timestamp": "2026-06-13T03:30:00.000Z"
    }
  ]
}
```

## 用户键盘导航

| 按键 | 功能 |
|------|------|
| `n` / `Space` | 下一段代码 |
| `p` | 上一段 |
| `c` | 进入评论模式（弹出输入框） |
| `d` | 切换 Diff 模式（git diff HEAD → working tree） |
| `j` | 向下滚动3行（vim 风格） |
| `k` | 向上滚动3行（vim 风格） |
| `↑` / `↓` | 滚动（3行） |
| `PgUp` / `PgDn` | 翻页 |
| `Home` / `End` | 跳顶/底 |
| `q` / `Esc` | 退出回到 shell |

## 评论系统流程

1. **走查中**：用户按 `c` → 弹出 HTML input 浮层，输入文字后 Enter 提交
2. **每步显示**：已提交的评论显示在代码下方（💬 标记）
3. **退出时**：如果有评论，按 q/Esc 会先显示 **总结页面**（按步骤分组列出所有评论）
4. **确认退出**：总结页面再按 Enter/q 彻底退出
5. **拉取评论**：调用 `get-comments` 获取评论数据
6. **确认修复**：在 Chat 中展示评论摘要，逐条确认是否修复
7. **执行修复**：确认后执行 patch / 代码修改

## Diff 模式

每个 step 同时预渲染代码高亮和 git diff，用户按 `d` 键切换：

- **代码视图**：bat 语法高亮 + 行号
- **Diff 视图**：`git diff HEAD` 彩色输出，显示当前工作区改动
- 底部导航栏显示 `[DIFF]` 标识当前模式

## 技术细节

### bat 渲染参数

```bash
bat --style=numbers --force-colorization --highlight-line {lines} \
    --line-range {start}:{end} --wrap=never --terminal-width=120 {file}
```

### 编码注意事项

- bat 输出的 `\n` 必须替换为 `\r\n`，否则 xterm.js 光标不回行首
- 中文 title/note 通过 base64 传输，前端解码必须用 `TextDecoder('utf-8')`，不能用 `atob()` 直接转字符串（会乱码）：

```javascript
const bytes = Uint8Array.from(atob(base64String), c => c.charCodeAt(0));
const text = new TextDecoder().decode(bytes);
```

## 典型用法

1. Agent 分析代码变更（如 `git diff`）
2. 将变更拆分为逻辑段落，每个段落构造一个 step
3. 调用 `action=start` 推送到终端
4. 用户在终端中浏览代码，按 `c` 对有疑问的地方写评论
5. 用户退出后，Agent 调用 `get-comments` 拉取评论
6. Agent 在 Chat 中展示评论，逐条确认后执行修复
