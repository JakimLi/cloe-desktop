# M2 增强需求：自动化 GIF 生成流程

## 背景

当前 M2 的基本 CRUD 流程已实现（新建动作集、添加/删除动作、切换激活），但参考图和 GIF 都需要手动上传。本需求的目标是**自动化 GIF 生成**：上传参考图后自动生成绿幕/蓝幕参考图，添加动作时输入提示词自动走完整 pipeline 生成 GIF。

## 现有资源

### 已有的 Python 脚本（不要重写，直接复用逻辑）

1. **`scripts/generate_gif_v2.py`** — 单个 GIF 生成脚本
   - 输入：参考图 + prompt + chromakey 类型
   - 流程：压缩参考图 → wan2.7-i2v 生成视频 → ffmpeg chromakey → Python 去色晕 → 透明 GIF
   - API Key 从 `~/.hermes/.env` 读取 `BAILIAN_API_KEY`
   - 输出：透明 GIF + 自动复制到 `public/gifs/`

2. **`scripts/batch_generate_gifs.py`** — 批量并行生成

### 现有 pipeline

```
参考图(绿/蓝背景) → wan2.7-i2v(百炼API) → 视频下载 → ffmpeg chromakey → Python去色晕 → 透明GIF
```

### API 详情（万相 wan2.7-i2v）

- **端点**: `https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`
- **Header**: `Authorization: Bearer {API_KEY}`, `X-DashScope-Async: enable`
- **Payload**:
  ```json
  {
    "model": "wan2.7-i2v",
    "input": {
      "prompt": "动作描述",
      "media": [{"type": "first_frame", "url": "data:image/png;base64,{base64}"}]
    },
    "parameters": {
      "resolution": "720P",
      "duration": 5,
      "prompt_extend": true,
      "watermark": false
    }
  }
  ```
- **轮询**: `GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`
- **返回**: `output.task_status` (PENDING/RUNNING/SUCCEEDED/FAILED), `output.video_url`

### 千问图片生成 API（生成绿幕参考图）

- **端点**: `https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis`
- **Header**: `Authorization: Bearer {DASHSCOPE_API_KEY}`, `X-DashScope-Async: enable`
- **Payload**:
  ```json
  {
    "model": "wanx2.1-t2i-turbo",
    "input": {
      "prompt": "生成绿幕背景的参考图描述"
    },
    "parameters": {
      "size": "1024*1024",
      "n": 1
    }
  }
  ```
- **轮询**: `GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}`
- **返回**: `output.task_status`, `output.results[0].url`
- **注意**: 用的是同一个 `DASHSCOPE_API_KEY`（百炼统一 key），但 model 不同

## 需求拆解

### 1. 设置页面增加 API Key 配置

**位置**: `preferences.js` 的偏好设置 tab 中增加一个新的 section

**新增配置项**:
- **百炼 API Key** (`DASHSCOPE_API_KEY`): 文本输入框，用于万相视频生成 + 千问图片生成（统一一个 key）
- **万相模型** (`WANXIANG_MODEL`): 下拉选择，默认 `wan2.7-i2v`，可扩展其他图生视频模型
- 所有配置保存在 `localStorage`，key 前缀 `cloe-`

**UI 设计**:
- 新增 "API 配置" section，放在 "通用" 下方
- API Key 用 password input（type="password"），旁边有眼睛按钮切换明文
- 模型选择用下拉菜单

**launcher.js 对应变更**:
- 新增 `GET /api-config` — 返回当前 API 配置（从 localStorage 读取不可行，因为 API 配置在管理窗口的 renderer 进程）
- **替代方案**: API Key 不存 localStorage，存在一个本地配置文件中，路径 `~/.cloe-desktop/config.json`（或者放在 `public/` 同级的 `.env-cloe` 文件里）
- launcher.js 新增：
  - `GET /api-config` — 读取配置文件返回
  - `POST /api-config` — 写入配置文件
- **注意**: 配置文件包含 API Key，不应被打进 asar。放在用户目录 `~/.cloe-desktop/config.json` 最安全

### 2. 自动生成绿幕参考图

**触发时机**: 新建动作集时，上传参考图后，增加一个"生成绿幕参考图"按钮

**流程**:
1. 用户在创建动作集 modal 中上传任意参考图（当前行为不变）
2. 上传后，参考图预览下方显示"AI 生成绿幕参考图"按钮
3. 用户点击后：
   a. 前端调用 `POST /action-sets/generate-reference` 接口
   b. Body: `{ imageBase64, chromakey: "green"|"blue", prompt: "可选的额外描述" }`
   c. 后端 (launcher.js) 调用千问图片生成 API，生成绿幕/蓝幕背景图
   d. 生成完成后，将图片保存为该动作集的参考图
   e. 返回新的参考图 base64，前端更新预览

**千问图片生成 prompt 构造**:
```
默认 prompt 模板:
"一个美丽的亚洲女孩，上半身半身照，{chromakey === 'green' ? '纯绿色背景 #00FF00' : '纯蓝色背景 #0000FF'}，自然坐姿，双手自然放身前，表情自然。电影质感，高清。{用户额外描述}"

如果用户上传了参考图，可以将参考图作为 style reference（如果 API 支持），或者仅用文字 prompt
```

**注意**:
- 千问图片生成是异步的（X-DashScope-Async: enable），需要轮询等待
- 后端生成完成后返回结果给前端，前端更新预览图
- 前端需要显示"生成中..."状态

### 3. 添加动作时支持 AI 生成 GIF

**当前**: 添加动作需要手动上传 GIF 文件
**变更**: 改为两种模式：
  - **手动上传**: 保持现有行为
  - **AI 生成**: 输入动作提示词，后端自动走 pipeline 生成 GIF

**UI 变更（Add Action Modal）**:

```
┌──────────────────────────────────────┐
│ 添加动作                          ✕  │
├──────────────────────────────────────┤
│ 动作名称 *                           │
│ [laugh_______________]               │
│                                      │
│ 生成方式                             │
│ [AI 生成 ▼]  (下拉：AI生成 / 手动上传)│
│                                      │
│ ── 当选择"AI 生成"时显示 ──          │
│ 动作提示词 *                         │
│ [她开心地大笑，身体微微晃动__]       │
│                                      │
│ 视频时长                             │
│ [5___] 秒 (下拉: 3/5)              │
│                                      │
│ ── 当选择"手动上传"时显示 ──         │
│ GIF 文件 *                           │
│ [选择文件...]                        │
│ [预览图]                             │
│                                      │
│ 触发类型                             │
│ [手动触发 ▼]                         │
│                                      │
│ [取消]  [开始生成]                    │
└──────────────────────────────────────┘
```

**API 变更**:

`POST /action-sets/:id/generate-action` — AI 生成动作 GIF（异步任务）
- Body: `{ name, prompt, duration?, chromakey? }`
- chromakey 默认用该动作集的 chromakey 配置
- 后端行为：
  1. 立即返回 `{ taskId: "xxx", status: "pending" }`（不要阻塞等待生成完成！）
  2. 在后端启动异步生成任务：
     a. 从动作集获取参考图路径
     b. 复用 generate_gif_v2.py 的逻辑（参考图压缩 → 提交万相API → 轮询 → 下载视频 → ffmpeg chromakey → Python去色晕 → GIF）
     c. 生成完成后，自动将 GIF 添加到动作集（更新 action-sets.json）
     d. 如果是活跃 set，广播 set-config
  3. 通过 WS 广播任务状态更新：
     - `{ type: "generation-progress", taskId, status: "generating_video", progress: 30 }`
     - `{ type: "generation-progress", taskId, status: "processing_gif", progress: 60 }`
     - `{ type: "generation-complete", taskId, actionName, gifPath }`
     - `{ type: "generation-error", taskId, error: "..." }`

**前端行为**:
- 提交后关闭 modal
- 状态栏显示"✓ 动作 GIF 正在生成中..."
- 前端监听 WS 消息 `generation-complete` / `generation-error`
- 收到 `generation-complete` 后自动刷新动作列表
- 收到 `generation-error` 后显示错误

### 4. 异步任务管理

**任务状态存储** (launcher.js 内存中):
```js
const generationTasks = new Map(); // taskId -> { status, actionName, setId, progress, error }
```

**新增 API**:
- `GET /generation-tasks` — 列出所有任务状态
- `GET /generation-tasks/:id` — 查询单个任务状态
- 任务完成后从 Map 中移除（保留最近 10 条历史）

### 5. 后端生成逻辑的实现

**关键**: launcher.js 是纯 Node.js，不能直接 import Python 脚本。需要在 launcher.js 中用 Node.js 实现生成逻辑，或者通过 `child_process.spawn` 调用 Python 脚本。

**推荐方案**: 用 `child_process.spawn` 调用已有的 `scripts/generate_gif_v2.py`，因为：
- Python 脚本已经过验证，包含复杂的去色晕逻辑
- 不需要在 Node.js 中重写 PIL/ffmpeg 处理
- 生成是异步的，spawn 完全适合

**spawn 调用**:
```js
const { spawn } = require('child_process');
const python = process.env.PYTHON3 || '/usr/bin/python3';
const args = [
  path.join(__dirname, 'scripts', 'generate_gif_v2.py'),
  '--action', actionName,
  '--prompt', prompt,
  '--reference', referencePath,
  '--chromakey', chromakey,
  '--duration', String(duration),
];
const proc = spawn(python, args, { cwd: path.join(__dirname) });
```

**但注意**: Python 环境可能有依赖问题（PIL, scipy, numpy, requests）。需要确认系统 Python 是否可用。

**备选方案（纯 Node.js）**: 如果不想依赖 Python，需要在 Node.js 中实现：
1. 调用万相 API（`https` 模块或 `node-fetch`）
2. ffmpeg chromakey（`child_process.exec` 调 ffmpeg）
3. GIF 处理（用 `sharp` 或 `gif-encoder-2`）

考虑到 Python 脚本已经很成熟，**推荐 spawn 方案**。

## 文件变更清单

| 文件 | 改动 |
|------|------|
| `launcher.js` | 新增 API config 读写、generate-reference API、generate-action API（异步 spawn）、任务状态管理、WS 广播 |
| `public/manager/actions.js` | 创建集 modal 增加绿幕生成按钮；添加动作 modal 改为双模式（AI生成/手动上传）；WS 监听生成进度 |
| `public/manager/actions.css` | 新按钮样式、生成中状态样式 |
| `public/manager/index.html` | Add Action Modal 改为双模式布局 |
| `public/manager/preferences.js` | 新增 API 配置 section |
| `public/manager/manager.css` | API Key 输入框样式 |
| `public/manager/locales/zh-CN.json` | 新增翻译键 |
| `public/manager/locales/en-US.json` | 新增翻译键 |
| `~/.cloe-desktop/config.json` | API Key 配置文件（新建，不进 git） |

## 技术要点

### API Key 存储
- **不要** 存在 localStorage（管理窗口 renderer 进程，不方便 launcher.js 读取）
- **不要** 打进 asar 包
- 存在 `~/.cloe-desktop/config.json`，launcher.js 读写，前端通过 API 读写

### 异步任务不阻塞 HTTP 响应
- `POST /action-sets/:id/generate-action` 立即返回 taskId
- 实际生成在后台进行（spawn Python 或 Node.js 异步）
- 进度通过 WS 推送给前端

### WebSocket 消息格式（新增）
```json
// 生成进度
{ "type": "generation-progress", "taskId": "xxx", "status": "generating_video", "progress": 30 }

// 生成完成
{ "type": "generation-complete", "taskId": "xxx", "actionName": "laugh", "setId": "default" }

// 生成失败
{ "type": "generation-error", "taskId": "xxx", "error": "API 限流，请稍后重试" }
```

### 参考图生成的 prompt

绿幕参考图 prompt（千问图片生成）:
```
一个美丽的亚洲女孩上半身半身照，纯绿色背景(#00FF00)，自然坐姿，双手自然放身前，表情自然放松。电影质感，高清摄影风格。上半身取景，从肩膀到腰部以上。
```

蓝幕参考图 prompt:
```
一个美丽的亚洲女孩上半身半身照，纯蓝色背景(#0000FF)，自然坐姿，双手自然放身前，表情自然放松。电影质感，高清摄影风格。上半身取景，从肩膀到腰部以上。
```

### ffmpeg 路径
- macOS 上 ffmpeg 通过 brew 安装: `/opt/homebrew/bin/ffmpeg` 或 `/usr/local/bin/ffmpeg`
- spawn Python 脚本时脚本内部调用 ffmpeg，需要确保 PATH 包含 ffmpeg
- 可以在 launcher.js 启动时检测 ffmpeg 路径

## 注意事项

1. **API 调用是异步的**：千问图片生成和万相视频生成都需要轮询等待（通常 30s-3min）
2. **API Key 可能无效或欠费**：需要优雅处理错误，通知前端
3. **Python 依赖**：generate_gif_v2.py 依赖 PIL, numpy, scipy, requests，需要确认环境
4. **不要阻塞主进程**：Electron main process 不能被长时间操作阻塞
5. **set-config 广播**：生成完成后如果是活跃 set，需要广播让 renderer 更新动作列表
6. **GIF 文件写入**：生成完成后需要写 `public/gifs/{name}.gif` 并更新 action-sets.json
7. **现有手动上传功能保留**：用户仍可以手动上传 GIF，两种模式并存
