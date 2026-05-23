# 嵌入终端使用

Cloe Desktop 内嵌 xterm.js 终端，与角色共享同一透明窗口，支持模式切换。

## 文件职责

| 文件 | 职责 |
|------|------|
| `launcher.js` | HTTP bridge 端点、窗口管理、PTY proxy 生命周期 |
| `preload.js` | 暴露 `ptySpawn`/`ptyWrite`/`ptyResize`/`setWindowMode` 等 IPC API |
| `src/renderer.js` | GIF/音频/WebSocket/Drag/特效（纯 Vanilla JS，不管理终端可见性） |
| `src/react/App.jsx` | Root 组件：visible/mode 状态、localStorage 同步、快捷键 |
| `src/react/TerminalMode.jsx` | xterm.js 封装（懒加载）、PTY spawn、fit/resize |
| `src/react/CanvasMode.jsx` | Excalidraw 封装（懒加载）、dark theme |
| `src/react/OverlayTitlebar.jsx` | macOS 风格交通灯按钮 + 模式切换器 |
| `scripts/pty-proxy.js` | 独立 Node.js 进程：运行 node-pty，通过 JSON lines 代理 I/O |

## 模式切换

单 BrowserWindow，三种模式通过调整窗口属性切换（不销毁重建）：

- **Character 模式**：`alwaysOnTop: true`，小窗口
- **Terminal 模式**：`alwaysOnTop: false`，75% 屏幕工作区，居中
- **Canvas 模式**：Terminal 模式基础上显示 Excalidraw

```bash
# 显示 canvas
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"canvas"}'

# 显示 terminal
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"terminal"}'

# 隐藏（回到角色模式）
curl -s -X POST http://localhost:19851/canvas/hide
```

## API 端点速查

| 端点 | 方法 | 说明 |
|------|------|------|
| `/canvas/show` | POST | 显示 overlay：`{"mode":"canvas"}` 或 `{"mode":"terminal"}` |
| `/canvas/hide` | POST | 隐藏 overlay |
| `/canvas/excalidraw/draw` | POST | 画元素：`{"elements":[...]}` |
| `/canvas/excalidraw/scene` | GET | 读取当前场景 |
| `/canvas/excalidraw/scene` | DELETE | 清空画布 |
| `/canvas/excalidraw/files` | POST | 注册图片文件：`{"files":{id:{mimeType,data}}}` |
| `/canvas/excalidraw/zoom` | POST | 缩放：`{"level":2}` |
| `/canvas/excalidraw/pan` | POST | 平移：`{"x":200,"y":300}` |
| `/canvas/excalidraw/select` | POST | 选中元素：`{"ids":["el1"]}` |
| `/canvas/excalidraw/deselect` | POST | 取消选中 |
| `/canvas/excalidraw/focus` | POST | 聚焦元素：`{"ids":["el1"]}` |
| `/canvas/excalidraw/elements` | DELETE | 删除元素：`{"ids":["el1"]}` |
| `/chat/message` | POST | 注入消息：`{"role":"assistant","content":"...","image":"<base64>"}` |
| `/screenshot` | GET | 截取窗口 PNG |

## 终端快捷键

- 使用 **document-level capture-phase keydown**（不用 Electron `globalShortcut`，后者在快捷键被占用时静默失败）
- 终端模式下拦截快捷键退出终端；非终端模式下 xterm 有焦点时不拦截
- 快捷键通过 `localStorage('cloe-terminal-shortcut')` 持久化，在管理界面配置

## macOS 风格交通灯按钮

`transparent: true` + `frame: false` 无法使用原生交通灯，用自定义 HTML/CSS 模拟：

- 红 `#ff5f57`、黄 `#febc2e`、绿 `#28c840`
- `inset box-shadow` 模拟内发光
- hover 时显示图标（×, −, ⤢）
- 32px 可拖拽标题栏

## 全屏支持

- `fullscreenable: true` 必须显式设置（`frame: false` 默认禁用全屏）
- 进入/退出全屏后触发 xterm `fitAddon.fit()`（~100ms 延迟）
- 通过 `onFullscreenChanged` preload API 暴露给 renderer

## 注意事项

- 改 `launcher.js` 或 `preload.js` 后必须重启 Electron（不是 Vite HMR 管的）
- node-pty 不能直接在 Electron 中加载（ABI 不匹配），必须通过 PTY proxy 子进程
- `#react-root` 设 `pointer-events: none`，内部 overlay 设 `auto`，否则隐藏时拦截 GIF 拖拽
- Terminal/Canvas 切换用 CSS `display: none/block`，不卸载组件（否则状态丢失）
