# M2-AUTOGEN 实现计划（Cursor 版）

## 目标

在现有 M2 基础上，增加 AI 自动生成绿幕参考图和 GIF 动画的能力。Python 脚本通过 spawn 调用，不打包进 Electron。

## 实现步骤

### Step 1: API Key 配置（preferences.js + launcher.js）

**1a. preferences.js — 新增"API 配置" section**

在 renderPreferences() 函数中，在"通用"section 和"关于"section 之间新增一个 section：

```html
<div class="pref-section">
  <h2 class="pref-section-title">API 配置</h2>
  <div class="pref-group">
    <div class="pref-item">
      <div class="pref-info">
        <div class="pref-label">百炼 API Key</div>
        <div class="pref-desc">用于万相视频生成和千问图片生成</div>
      </div>
      <div class="pref-control">
        <div class="input-with-toggle">
          <input type="password" id="pref-api-key" class="form-input form-input-sm" placeholder="sk-...">
          <button id="pref-api-key-toggle" class="btn-icon btn-icon-sm" title="显示/隐藏">👁</button>
        </div>
      </div>
    </div>
    <div class="pref-item">
      <div class="pref-info">
        <div class="pref-label">视频生成模型</div>
        <div class="pref-desc">默认 wan2.7-i2v</div>
      </div>
      <div class="pref-control">
        <select id="pref-video-model" class="form-select form-select-sm">
          <option value="wan2.7-i2v">wan2.7-i2v</option>
        </select>
      </div>
    </div>
  </div>
</div>
```

- 读取配置: `GET /api-config` → 拿到后填充输入框
- 保存配置: API Key input 的 `change` 事件 → `POST /api-config` 保存
- 密码切换: 点击 👁 按钮 toggle input 的 type

新增 i18n key（zh-CN.json / en-US.json）：
```json
"prefs": {
  "apiConfig": "API 配置",
  "apiKey": "百炼 API Key",
  "apiKeyDesc": "用于万相视频生成和千问图片生成",
  "videoModel": "视频生成模型",
  "videoModelDesc": "默认 wan2.7-i2v"
}
```

**1b. launcher.js — API 配置读写**

配置文件路径: `~/.cloe-desktop/config.json`

```js
function getConfigPath() {
  return path.join(os.homedir(), '.cloe-desktop', 'config.json');
}

function loadConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function saveConfig(config) {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}
```

新增 API：
- `GET /api-config` → `res.end(JSON.stringify(loadConfig()))`
- `POST /api-config` → 读取 body，merge 进 config，saveConfig()，返回保存后的 config

### Step 2: 自动生成绿幕参考图

**2a. launcher.js — 新增 `POST /action-sets/generate-reference`**

```
Body: { imageBase64: string, chromakey: "green"|"blue", prompt?: string }

流程:
1. 读取 API Key（从 config.json，fallback 到 ~/.hermes/.env 的 BAILIAN_API_KEY）
2. 构造 prompt:
   const defaultPrompt = chromakey === 'green'
     ? "一个美丽的亚洲女孩上半身半身照，纯绿色背景(#00FF00)，自然坐姿..."
     : "一个美丽的亚洲女孩上半身半身照，纯蓝色背景(#0000FF)，自然坐姿...";
3. 调用千问图片生成 API（异步）:
   POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis
   Header: Authorization: Bearer {key}, X-DashScope-Async: enable
   Body: { model: "wanx2.1-t2i-turbo", input: { prompt }, parameters: { size: "1024*1024", n: 1 } }
4. 轮询 GET /api/v1/tasks/{task_id}，等待 SUCCEEDED
5. 下载生成的图片 (results[0].url)
6. 将图片 base64 返回给前端
7. 响应: { imageBase64: string, imageUrl: string }
```

**2b. actions.js — 创建集 modal 中增加生成按钮**

在参考图预览区域下方，当已有参考图时显示按钮：
```
[AI 生成绿幕参考图]  [AI 生成蓝幕参考图]
```

点击后：
1. 禁用按钮，显示"生成中..."
2. `POST /action-sets/generate-reference`，传入当前参考图
3. 收到结果后更新 `setReferenceBase64` 和预览图
4. 同时更新参考图的 `src` 为新的 base64 图片

### Step 3: 添加动作支持 AI 生成（核心）

**3a. launcher.js — 新增 `POST /action-sets/:id/generate-action`**

这是最重要的 API，必须是异步的（不阻塞 HTTP 响应）。

```
Body: { name: string, prompt: string, duration?: number, chromakey?: string }

流程:
1. 生成 taskId (短随机字符串)
2. 立即返回 { taskId, status: "pending" }
3. 在后台启动生成流程（用 async IIFE 或 setImmediate，不要用 await 阻塞）:

   a. 广播 WS: { type: "generation-progress", taskId, status: "starting", progress: 5 }
   b. 获取参考图路径（从该 set 的 reference 字段解析出绝对路径）
   c. 获取 chromakey（用 body 传的或 set 默认的）
   d. 获取 API Key（config.json 或 ~/.hermes/.env）

   e. 广播 WS: { type: "generation-progress", taskId, status: "generating_video", progress: 10 }

   f. 调用万相 wan2.7-i2v API 生成视频（复用 generate_gif_v2.py 的逻辑）：
      - 压缩参考图（如果 > 4MB，用 sharp 或跳过，Python 脚本会处理）
      - POST 视频生成任务
      - 轮询等待完成（每10s一次，最长10分钟）
      - 下载视频到临时文件

   g. 广播 WS: { type: "generation-progress", taskId, status: "processing_gif", progress: 50 }

   h. spawn Python 脚本处理视频 → GIF:
      const proc = spawn('/usr/local/bin/python3', [
        path.join(__dirname, 'scripts', 'generate_gif_v2.py'),
        '--action', name,
        '--prompt', prompt,
        '--reference', referencePath,
        '--chromakey', chromakey,
        '--duration', String(duration || 5),
      ], { cwd: path.join(__dirname) });

      注意：generate_gif_v2.py 会自己调 API 生成视频再处理，
      但我们已经在步骤 f 生成了视频，所以这里有两个选择：

      选择 A: 让 Python 脚本从头开始（它会重新提交 API），简单但会多一次 API 调用
      选择 B: 只让 Python 做视频→GIF 部分（需要改脚本或单独写 ffmpeg+去色晕逻辑）

      **推荐选择 A**：简单可靠，Python 脚本是完整 pipeline，让 Python 重新走一遍。
      launcher.js 只需要 spawn 然后等待完成。
      API Key 通过环境变量传：proc.env.BAILIAN_API_KEY = apiKey

   i. 监听 proc 的 stdout/stderr 获取进度，通过 WS 广播
   j. proc 完成后检查 exit code
   k. 如果成功：GIF 已在 public/gifs/{name}.gif，更新 action-sets.json
      - 广播 WS: { type: "generation-complete", taskId, actionName: name, setId }
      - 如果是活跃 set，broadcastSetConfig(setId)
   l. 如果失败：
      - 广播 WS: { type: "generation-error", taskId, error: "..." }

4. 在内存中维护任务状态:
   const generationTasks = new Map();
   // taskId -> { status, actionName, setId, progress, startedAt }
```

**关键**: 不要在 HTTP handler 中 await 生成完成！立即 res.end()，然后后台执行。

新增 API：
- `GET /generation-tasks` — 返回所有任务状态列表
- `GET /generation-tasks/:taskId` — 返回单个任务

**3b. actions.js — Add Action Modal 改造**

改造现有 Add Action Modal，增加生成方式切换：

```
┌──────────────────────────────────────┐
│ 添加动作                          ✕  │
├──────────────────────────────────────┤
│ 动作名称 *                           │
│ [laugh_______________]               │
│                                      │
│ 生成方式                             │
│ [AI 生成 ▼]  (下拉)                  │
│                                      │
│ ── AI 生成模式 ──                    │
│ 动作提示词 *                         │
│ [她开心地大笑，身体微微晃动__]       │
│ 视频时长 [5] 秒                      │
│                                      │
│ ── 手动上传模式 ──                   │
│ GIF 文件 [选择文件...]               │
│                                      │
│ 触发类型 [手动触发 ▼]                │
│ [取消]  [开始生成]                    │
└──────────────────────────────────────┘
```

提交逻辑：
- AI 生成模式: `POST /action-sets/:id/generate-action` → 关闭 modal → 状态栏显示"生成中"
- 手动上传模式: 保持现有逻辑不变

WS 监听（在 initActionsTab 中已连接的 WS 上）：
- 管理窗口需要自己的 WS 连接到 bridge 来接收生成进度
- `generation-complete` → 刷新当前 set 的动作列表 + 成功提示
- `generation-error` → 错误提示

**注意**: 管理窗口（manager）需要新建一个 WebSocket 连接到 `ws://127.0.0.1:19850` 来接收异步通知。

### Step 4: i18n 更新

在 zh-CN.json 和 en-US.json 中添加新的翻译键。

## 注意事项

1. **Python 脚本路径**: `scripts/generate_gif_v2.py` 相对于项目根目录，launcher.js 中用 `path.join(__dirname, 'scripts', ...)` 获取
2. **不打包 Python**: Python 脚本和依赖不在 Electron asar 中，后续提供安装脚本
3. **API Key 降级**: config.json → ~/.hermes/.env 的 BAILIAN_API_KEY
4. **ffmpeg 依赖**: Python 脚本内部调用 ffmpeg，系统需安装
5. **错误处理**: API 限流(429)、欠费、Python 不存在、ffmpeg 不存在都需要优雅处理
6. **不要阻塞 main process**: 所有耗时操作用 spawn 或异步 I/O
7. **public/manager/ 下是普通 script，不是 ES module，不要用 import**
8. **GIF_ANIMATIONS 在 renderer.js 中是 `let` 不是 `const`（之前已改过）**
