---
name: cloe-desktop-canvas
description: Cloe Desktop Excalidraw 画布编程式控制——增量画图、一边说一边画、API 端点、架构避坑
---

# Cloe Desktop Canvas — Excalidraw 编程式画图

## 前置条件

Cloe Desktop 运行中，Canvas 模式已激活：

```bash
# 激活 Canvas 模式
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"canvas"}'

# 切回 Terminal 模式
curl -s -X POST http://localhost:19851/canvas/hide

# 切到 Terminal 模式
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"terminal"}'
```

## 核心架构（3 个关键决策）

### 1. Main → React 通信：CustomEvent，不是 StorageEvent

launcher.js 通过 `executeJavaScript` 在 renderer 中派发 `CustomEvent('cloe-bridge')`，React 的 App.jsx 监听并调用 show/hide。

**为什么不用 StorageEvent：** 之前用 `dispatchEvent(new StorageEvent(...))` 模拟会导致 React 状态链路崩塌，整个窗口死掉。CustomEvent 直接触发，更简单更稳。

**launcher.js 端：**
```js
// 通过 executeJavaScript 派发 CustomEvent
var code = [
  '(function() {',
  "  window.dispatchEvent(new CustomEvent('cloe-bridge', {",
  "    detail: { action: 'show', mode: 'canvas' }",
  "  }));",
  "  return 'ok';",
  '})()',
].join('\n');
win.webContents.executeJavaScript(code, true);
```

**React 端 (App.jsx)：**
```jsx
useEffect(() => {
  const handler = (e) => {
    const cmd = e.detail;
    if (cmd?.action === 'show') show(cmd.mode || 'terminal');
    else if (cmd?.action === 'hide') hide();
  };
  window.addEventListener('cloe-bridge', handler);
  return () => window.removeEventListener('cloe-bridge', handler);
}, [show, hide]);
```

### 2. 元素创建：官方 Skeleton API（`convertToExcalidrawElements`）

**废弃方案：** 之前用 `normalizeElement` 手动补全所有必需字段。问题：文本宽高需要手动估算（CJK/Latin 不同字符宽度），不稳定，容易截断。Excalidraw 的 `updateScene` 插入文本时宽高计算是已知痛点（GitHub Issues 确认）。

**当前方案：** 使用 `@excalidraw/excalidraw` 包的 `convertToExcalidrawElements(skeletons, { regenerateIds: false })`。传入 `ExcalidrawElementSkeleton`（最简 JSON），Excalidraw 内部自动计算文本尺寸、生成随机种子、填充版本号等所有必需字段。

**CanvasMode.jsx 的 `window.cloeExcalidraw.updateScene` 方法：**
1. 接收 skeleton 对象数组（最简 JSON：id + type + 位置 + 文本/颜色）
2. 调用 `convertToExcalidrawElements(skeletons, { regenerateIds: false })` 生成合规元素
3. 按 id 合并到 `elementsRef`，支持增量绘制

**`regenerateIds: false`**：保留 skeleton 中指定的 `id`，对增量更新（通过 id 覆盖或保留旧元素）至关重要。

最简画图示例（text 的宽高由 Excalidraw 自动计算）：
```bash
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw \
  -H 'Content-Type: application/json' -d '{
    "elements": [
      { "id": "box1", "type": "rectangle", "x": 100, "y": 100, "width": 200, "height": 80,
        "strokeColor": "#ff6b6b", "backgroundColor": "#ff6b6b33", "roundness": { "type": 3 } },
      { "id": "text1", "type": "text", "x": 130, "y": 125,
        "text": "Hello World 很长的中文也不会截断", "fontSize": 20, "strokeColor": "#ff6b6b",
        "boundElements": [{ "id": "box1", "type": "rectangle" }] }
    ]
  }'
```

**text 类型不再需要手动设置 width/height**，`convertToExcalidrawElements` 会根据文本内容和字体自动计算。

### 自动撑框（boundElements）

如果 text 元素有 `boundElements` 指向一个容器（rectangle/ellipse/diamond），CanvasMode 会自动：
1. 把容器宽高扩展到 `max(原始宽高, 文字宽高 + 48px padding)`
2. 把文字居中到容器内

```json
{
  "id": "text1", "type": "text", "x": 200, "y": 105,
  "text": "任意长度文字",
  "fontSize": 18,
  "strokeColor": "#ffffff",
  "boundElements": [{ "id": "box1", "type": "rectangle" }]
}
```

- 容器写最小宽高即可，不够会自动扩展
- 支持 rectangle、ellipse、diamond 三种容器
- 不加 `boundElements` 的纯文字/纯框不受影响
- 容器位置由 skeleton 中的 `x`/`y` 决定，文字自动居中

### 黑色文字自动转白

CanvasMode 会将 `#000000`、`#000`、`black` 的文字颜色强制改为 `#ffffff`，因为透明黑底上黑色文字完全不可见。其他颜色保持原样。

### ⚠️ 深色背景配色建议

Cloe Desktop 画布背景为**黑色透明**（`viewBackgroundColor: transparent`），深色文字几乎不可见。

**文字颜色**：默认用 `#ffffff`（白色）或浅色（`#dfe6e9`、`#b2bec3`）
**容器/线条**：用饱和色系（`#a29bfe` 紫、`#55efc4` 绿、`#fd79a8` 粉、`#74b9ff` 蓝、`#ffeaa7` 黄），`backgroundColor` 加 `33` 或 `44` 后缀做半透明填充

**❌ 不要用 backdrop-filter blur（毛玻璃）或半透明黑色背景**：实测角色会被虚化/遮挡，文字依然看不清。正确做法就是白色文字 + 彩色框。

### 3. 增量合并：elementsRef 作为权威数据源，不用 getSceneElements() 回读

**核心问题：** `api.updateScene({ elements })` 是全量替换。如果每次画新元素只传新元素，旧的就被覆盖。如果先 `getSceneElements()` 取旧的再合并传回去，Excalidraw 内部状态不一致导致被丢弃。

**解决方案：** 用 `useRef([])` 自己维护元素列表作为 source of truth：
- `updateScene`: 新元素按 id 合并到 ref，再全量推给 Excalidraw
- `onChange`: Excalidraw 回调（用户手绘）同步回 ref
- `resetScene`: 清空 ref + 调 api 清空
- `getSceneElements`: 返回 ref 内容

## API 端点

### 增量画图
```bash
# 添加/更新元素（增量，按 id 去重合并）
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw \
  -H 'Content-Type: application/json' -d '{"elements": [...]}'

# 读取当前画布所有元素
curl -s http://localhost:19851/canvas/excalidraw/scene

# 清空画布
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/scene
```

### 模式切换
```bash
# 显示（canvas 或 terminal）
curl -s -X POST http://localhost:19851/canvas/show \
  -H 'Content-Type: application/json' -d '{"mode":"canvas"}'

# 隐藏（回到角色模式）
curl -s -X POST http://localhost:19851/canvas/hide
```

## 一边说一边画

TTS 语音用 `generate_tts.py --speak`（详见 cloe-desktop-action skill）：

```bash
# 先画
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw -H 'Content-Type: application/json' -d '{"elements": [...]}'

# 再说
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "解说内容" --speak
```

注意 TTS 生成约 3 秒，可以先发 TTS 再画下一批（TTS 返回前画图不阻塞）。MOSI speak 播放期间其他 action 被 drop，但 draw 端点不受影响。

## ⚠️ 踩坑记录

### 模式切换不能卸载组件（内容会丢）
**关键：** App.jsx 中 Terminal/Canvas 切换不能用三元表达式 `{mode === 'terminal' ? <TerminalMode /> : <CanvasMode />}`。这样切模式会 unmount 组件，CanvasMode 的 ref 被销毁，Excalidraw 内容全丢。

**正确做法：** 两个组件同时渲染，用 CSS `display: none/block` 控制显隐：
```jsx
<div style={{ display: mode === 'terminal' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
  <TerminalMode />
</div>
<div style={{ display: mode === 'canvas' ? 'block' : 'none', position: 'absolute', inset: 0 }}>
  <CanvasMode />
</div>
```
这样切回 Canvas 时组件还在，ref 和 Excalidraw 状态完整保留。

### executeJavaScript 中不能嵌套模板字符串
Node.js 解析器遇到 `` `(${var})` `` 这种嵌套反引号会崩溃。用字符串数组 `.join('\n')` 拼接。

### React cleanup 安全
`useEffect` cleanup 中调用 `unsub?.()` 时，如果 unsub 不是函数会报 `unsub is not a function`。用 `typeof unsub === 'function'` 检查。

### Excalidraw lazy load
CanvasMode 用 `import('@excalidraw/excalidraw')` 懒加载。首次 mount 时 Excalidraw 还没加载完，此时 `window.cloeExcalidraw` 为 undefined。`/canvas/excalidraw/draw` 在 cloeExcalidraw 不存在时返回 `{error:"not loaded"}`。确保先 `/canvas/show` 等 HMR 生效再画。

### transparent 背景报错
如果元素缺 `backgroundColor` 等字段，Excalidraw 内部 `isTransparent()` 函数会读 `.length` 导致 TypeError。使用 Skeleton API 后此问题已自动解决——`convertToExcalidrawElements` 会补全所有必需字段。

### ~~手动 normalizeElement 已废弃~~
之前用手动补全所有必需字段 + 估算文本宽高的方案已移除。文本宽度估算（CJK 2em / Latin 0.6em）不稳定，长文本容易截断。改用 `convertToExcalidrawElements` 后不再需要手动处理。

### ❌ 毛玻璃/半透明背景不可用
试过 `backdrop-filter: blur(8px)` 和 `backgroundColor: rgba(0,0,0,0.75)` 两种方案：
- 毛玻璃：角色被虚化看不清，文字依然看不清（blur 不改变对比度）
- 半透明黑底：角色被遮挡，文字还是看不清
- **最终方案**：什么都不加，只强制黑色文字转白。白色文字在透明背景上清晰可见，彩色框也足够醒目。

### Tab 图标用 SVG，不用 emoji
OverlayTitlebar 的 mode-switcher 按钮用内联 SVG 图标 + `<span className="mode-label">` 文字标签，不用 emoji（⌨🎨 太随意）。Terminal 用终端+光标 SVG，Canvas 用网格+点 SVG。样式在 `style.css` 的 `.mode-btn` 中，`gap: 4px` 让图标和文字间距一致。

## 关键文件

| 文件 | 职责 |
|------|------|
| `src/react/CanvasMode.jsx` | Excalidraw 封装、Skeleton API 转换、增量合并 bridge |
| `src/react/App.jsx` | cloe-bridge CustomEvent 监听、模式切换（CSS display 切换，不卸载组件） |
| `src/react/OverlayTitlebar.jsx` | macOS titlebar、SVG tab 图标 |
| `src/style.css` | `.mode-btn` 样式、Excalidraw 透明覆盖 |
| `launcher.js` | `/canvas/*` HTTP 端点、executeJavaScript 桥接 |
