# Cloe Canvas — MVP 文档

> Cloe Desktop 的画布系统，支持元素渲染、粘贴交互、标注和 Mode 插件。

## 目录

- [架构概览](#架构概览)
- [Element 数据结构](#element-数据结构)
- [Canvas HTTP API](#canvas-http-api)
- [Mode 系统](#mode-系统)
- [使用示例](#使用示例)
- [文件结构](#文件结构)

---

## 架构概览

```
┌──────────────────────────────────────────────────────────────┐
│                      launcher.js (Electron Main)             │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │  HTTP Server  │  │  Canvas Elements │  │  Canvas Mode  │  │
│  │  :19851       │  │  (in-memory[])   │  │  State Machine│  │
│  └──────┬───────┘  └────────┬─────────┘  └───────┬────────┘  │
│         │                   │                     │           │
│  ┌──────┴───────────────────┴─────────────────────┴────────┐  │
│  │              broadcastCanvasUpdate() / broadcastMode()  │  │
│  └─────────────────────────┬───────────────────────────────┘  │
└────────────────────────────┼──────────────────────────────────┘
                             │ IPC (canvas-update, canvas-mode-change)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                  Canvas BrowserWindow                         │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  canvas-preload.js (contextBridge → window.canvasAPI)    │ │
│  └────────────────────────┬────────────────────────────────┘ │
│  ┌────────────────────────┴────────────────────────────────┐ │
│  │  canvas-renderer.js + element-model.js + mode-system.js │ │
│  │  ┌───────────────┐  ┌──────────────────────────────┐   │ │
│  │  │  Element Core │  │  Mode Plugin System           │   │ │
│  │  │  - CRUD       │  │  - mode-system.js (registry)  │   │ │
│  │  │  - Paste      │  │  - modes/code-review.js       │   │ │
│  │  │  - Render     │  │  - (future: design, etc.)     │   │ │
│  │  └───────────────┘  └──────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                             ▲
                             │ HTTP REST API (curl / Hermes / scripts)
                    http://localhost:19851
```

### 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **Electron Main** | `launcher.js` | HTTP API 服务器、Canvas Window 管理、元素存储 |
| **Canvas Preload** | `canvas-preload.js` | IPC 桥接，暴露 `window.canvasAPI` |
| **Element Model** | `src/canvas/element-model.js` | 元素数据结构定义、创建、验证 |
| **Canvas Renderer** | `src/canvas/canvas-renderer.js` | DOM 渲染、粘贴交互、标注渲染 |
| **Mode System** | `src/canvas/mode-system.js` | Mode 注册表、切换、上下文格式化 |
| **Code Review Mode** | `src/canvas/modes/code-review.js` | 代码审查模式插件 |
| **Canvas HTML** | `src/canvas/canvas.html` | 画布页面入口 |

---

## Element 数据结构

每个画布元素遵循以下 JSON 结构：

```json
{
  "id": "el_m1abc_defgh",
  "type": "text",
  "x": 50,
  "y": 50,
  "w": 200,
  "h": 120,
  "content": "Hello Canvas!",
  "style": {
    "opacity": 1,
    "rotation": 0,
    "fontSize": 16,
    "fontWeight": "normal",
    "color": "#333333",
    "textAlign": "left",
    "backgroundColor": "transparent",
    "borderColor": "#cccccc",
    "borderWidth": 2,
    "borderRadius": 4,
    "strokeColor": "#ff4444",
    "strokeWidth": 2,
    "highlightColor": "rgba(255, 255, 0, 0.35)"
  },
  "author": "anonymous",
  "timestamp": 1716300000000
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 唯一标识符（`el_<timestamp>_<random>`） |
| `type` | string | ✅ | 元素类型，见下表 |
| `x` | number | ✅ | X 坐标 (px) |
| `y` | number | ✅ | Y 坐标 (px) |
| `w` | number | ✅ | 宽度 (px) |
| `h` | number | ✅ | 高度 (px) |
| `content` | string | — | 文本内容 / 图片 URL |
| `style` | object | — | 样式配置（见上） |
| `author` | string | — | 创建者 |
| `timestamp` | number | — | 创建时间戳 (ms) |

### 元素类型

| type | 说明 | content 含义 |
|------|------|-------------|
| `text` | 文本块（含代码） | 文本内容 |
| `image` | 图片 | 图片 URL 或 base64 |
| `rect` | 矩形 | — |
| `arrow` | 箭头 | — |
| `highlight` | 高亮区域 | — |
| `annotation` | 标注（Cloe/Hermes） | 标注文本 |
| `emoji` | Emoji 表情 | emoji 字符 |

---

## Canvas HTTP API

所有端点基于 `http://localhost:19851`。

### 元素 CRUD

#### 获取所有元素

```
GET /canvas/elements
```

```bash
curl http://localhost:19851/canvas/elements
```

**Response:** `{ "elements": [...] }`

#### 添加元素

```
POST /canvas/elements
Content-Type: application/json

{ "id": "el_1", "type": "text", "x": 50, "y": 50, "w": 200, "h": 100, "content": "Hello" }
```

```bash
curl -X POST http://localhost:19851/canvas/elements \
  -H "Content-Type: application/json" \
  -d '{"id":"el_1","type":"text","x":50,"y":50,"w":200,"h":100,"content":"Hello World"}'
```

**Response:** `{ "ok": true, "element": {...}, "total": 1 }`

#### 更新元素

```
PUT /canvas/elements/:id
Content-Type: application/json

{ "content": "Updated text" }
```

```bash
curl -X PUT http://localhost:19851/canvas/elements/el_1 \
  -H "Content-Type: application/json" \
  -d '{"content":"Updated text","x":100}'
```

**Response:** `{ "ok": true, "element": {...} }`

#### 删除元素

```
DELETE /canvas/elements/:id
```

```bash
curl -X DELETE http://localhost:19851/canvas/elements/el_1
```

**Response:** `{ "ok": true, "total": 0 }`

#### 清空所有元素

```
DELETE /canvas
```

```bash
curl -X DELETE http://localhost:19851/canvas
```

**Response:** `{ "ok": true, "total": 0 }`

### 批量同步

```
POST /canvas/sync
Content-Type: application/json

[{ "id": "el_1", "type": "text", ... }, { "id": "el_2", ... }]
```

或:

```
POST /canvas/sync
Content-Type: application/json

{ "elements": [...] }
```

```bash
curl -X POST http://localhost:19851/canvas/sync \
  -H "Content-Type: application/json" \
  -d '[{"id":"el_1","type":"text","x":0,"y":0,"w":200,"h":100,"content":"First"},{"id":"el_2","type":"rect","x":220,"y":0,"w":100,"h":100}]'
```

**Response:** `{ "ok": true, "total": 2 }`

> ⚠️ `sync` 是全量替换，会清除现有元素。

### Mode 管理

#### 获取当前模式

```
GET /canvas/mode
```

```bash
curl http://localhost:19851/canvas/mode
```

**Response:** `{ "mode": "free" }` 或 `{ "mode": "code-review" }`

#### 设置模式

```
POST /canvas/mode
Content-Type: application/json

{ "name": "code-review" }
```

```bash
# 切换到 code-review 模式
curl -X POST http://localhost:19851/canvas/mode \
  -H "Content-Type: application/json" \
  -d '{"name":"code-review"}'

# 切换回自由模式
curl -X POST http://localhost:19851/canvas/mode \
  -H "Content-Type: application/json" \
  -d '{"name":"free"}'
```

**Response:** `{ "ok": true, "mode": "code-review" }`

#### 重置模式

```
POST /canvas/mode/reset
```

```bash
curl -X POST http://localhost:19851/canvas/mode/reset
```

**Response:** `{ "ok": true, "mode": "free" }`

---

## Mode 系统

### 设计理念

Mode 系统是一个**插件式架构**，允许画布在不同「模式」下呈现不同的行为和工具集。
例如，`code-review` 模式会自动识别代码元素、添加行号、并为 LLM 提供格式化的审查上下文。

### Mode 接口

每个 Mode 插件必须实现以下接口：

```typescript
interface CanvasMode {
  name: string;              // 唯一模式名称
  inputs: string[];          // 接受的输入类型（如 ['text', 'image']）
  tools: string[];           // 可用工具名称（如 ['annotate', 'suggest']）
  onInput(elements): void;   // 新元素添加时触发
  getCloeContext(elements): string;  // 格式化元素为 LLM 上下文
}
```

### 内置模式

#### `code-review` — 代码审查模式

- **触发条件**: 切换到此模式后自动生效
- **输入类型**: `text`, `image`
- **可用工具**: `annotate`, `suggest`, `approve`
- **行为**:
  - 自动检测代码元素（通过正则匹配 `function`, `const`, `import` 等关键词）
  - 为代码元素标记 `_codeReview: true`
  - `getCloeContext()` 输出带行号的代码上下文，附带审查提示词
  - LLM 返回的标注以 JSON 格式渲染

### 注册自定义 Mode

```javascript
import { registerMode } from './mode-system.js';

registerMode('my-custom-mode', {
  name: 'my-custom-mode',
  inputs: ['text', 'image'],
  tools: ['annotate'],
  onInput(elements) {
    console.log('New elements:', elements);
  },
  getCloeContext(elements) {
    return JSON.stringify([...elements], null, 2);
  },
});
```

### Mode API 流程

```
POST /canvas/mode { name: "code-review" }
  → launcher.js 设置 currentCanvasMode
  → IPC broadcast canvas-mode-change → canvas window
  → mode-system.js switchMode()
  → 后续粘贴的元素通过 mode.onInput() 处理
```

---

## 使用示例

### 1. 基本元素操作

```bash
# 添加一段文本
curl -X POST http://localhost:19851/canvas/elements \
  -H "Content-Type: application/json" \
  -d '{
    "id": "code_1",
    "type": "text",
    "x": 40, "y": 30,
    "w": 600, "h": 200,
    "content": "function hello() {\n  console.log(\"Hello Canvas!\");\n}"
  }'

# 添加一个标注
curl -X POST http://localhost:19851/canvas/elements \
  -H "Content-Type: application/json" \
  -d '{
    "id": "ann_1",
    "type": "annotation",
    "x": 40, "y": 240,
    "w": 300, "h": 40,
    "content": "⚠️ Consider using template literals",
    "author": "hermes"
  }'

# 查看所有元素
curl http://localhost:19851/canvas/elements | jq .
```

### 2. 代码审查模式

```bash
# 切换到代码审查模式
curl -X POST http://localhost:19851/canvas/mode \
  -H "Content-Type: application/json" \
  -d '{"name":"code-review"}'

# 添加代码到画布（会自动检测和标记）
curl -X POST http://localhost:19851/canvas/elements \
  -H "Content-Type: application/json" \
  -d '{
    "id": "code_2",
    "type": "text",
    "x": 40, "y": 300,
    "w": 600, "h": 150,
    "content": "const express = require(\"express\");\nconst app = express();\n\napp.get(\"/\", (req, res) => {\n  res.send(\"Hello\");\n});"
  }'

# 查看当前模式
curl http://localhost:19851/canvas/mode

# 退出代码审查模式
curl -X POST http://localhost:19851/canvas/mode/reset
```

### 3. 批量同步画布

```bash
# 用 JSON 数组一次性设置所有元素
curl -X POST http://localhost:19851/canvas/sync \
  -H "Content-Type: application/json" \
  -d '[
    {"id":"el_a","type":"text","x":20,"y":20,"w":300,"h":80,"content":"Design Review Notes"},
    {"id":"el_b","type":"rect","x":20,"y":110,"w":300,"h":200,"style":{"borderColor":"#4CAF50","borderWidth":3}},
    {"id":"el_c","type":"annotation","x":30,"y":320,"w":280,"h":30,"content":"✅ Approved","author":"cloe"}
  ]'
```

### 4. 粘贴交互（Canvas Window 内）

在 Canvas BrowserWindow 中：

- **⌘V / Ctrl+V** — 粘贴剪贴板内容到画布
  - 文本 → 自动创建 `text` 类型元素
  - 图片 → 自动创建 `image` 类型元素
  - 代码 → 自动创建带样式的代码块
- **标注渲染** — Hermes 发送的标注会以 fadeIn 动画出现在画布上

---

## 文件结构

```
cloe-desktop/
├── launcher.js              # Electron 主进程 + HTTP API 服务器
├── canvas-preload.js        # Canvas Window 的 preload 脚本（IPC 桥接）
├── src/canvas/
│   ├── canvas.html          # 画布页面 HTML 入口
│   ├── canvas.css           # 画布样式
│   ├── canvas-renderer.js   # DOM 渲染引擎 + 粘贴交互 + 标注渲染
│   ├── element-model.js     # Element 数据结构定义
│   ├── mode-system.js       # Mode 插件系统（注册、切换、上下文）
│   └── modes/
│       └── code-review.js   # Code Review 模式实现
├── public/canvas/           # 构建后的画布文件（Vite 输出）
│   ├── index.html
│   ├── canvas.css
│   └── canvas.js
└── CANVAS-README.md         # 本文档
```

---

## 开发

```bash
# 启动 Vite 开发服务器（画布页面热更新）
npm run dev

# 启动 Electron（包含画布窗口和 HTTP API）
npm run electron
```

画布页面通过 `http://localhost:5173/canvas/index.html` 访问，
HTTP API 通过 `http://localhost:19851` 提供。
