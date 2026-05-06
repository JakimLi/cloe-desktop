---
name: cloe-desktop
description: Cloe 桌面小组件 — Electron透明悬浮窗 + AI预生成GIF动画 + TTS语音，与Hermes WebSocket打通。纯Node.js无Python依赖，支持electron-builder打包DMG。
---

# Cloe Desktop — 桌面角色伴侣

基于 Electron + Vite 的桌面小组件，GIF动画方案（AI生成透明背景GIF）。Python脚本（GIF生成）通过spawn调用，不打包进Electron，后续提供安装脚本。

## 技术栈

- **Electron** — 透明无边框悬浮窗，always on top
- **Vite** — 前端构建
- **Node.js ws** — WebSocket bridge（**内嵌在 launcher.js 中**，零外部依赖）
- **Alibaba Bailian** — wan2.7-i2v 生成视频 → GIF pipeline
- **MOSS-TTS** — 语音合成（speak 动作配音频）

## 项目位置

`~/work/cloe-desktop/`
GitHub: `https://github.com/JakimLi/cloe-desktop`

## 首次安装

```bash
cd ~/work/cloe-desktop
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install --registry https://registry.npmmirror.com
```

## 启动方式

**开发模式**（需要分别启动 Vite 和 Electron，两个终端）：
```bash
# Terminal 1: Vite dev server
cd ~/work/cloe-desktop && npx vite --port 5173

# Terminal 2: Electron（等 Vite 就绪后）
cd ~/work/cloe-desktop && npx electron .
```

**注意**：`npm run dev` 可能不可靠，推荐手动分两个终端启动。Electron 启动后检查 `curl -s http://localhost:19851/status`，clients=1 才算成功。
DevTools 自动打开（`isDev` 检测）。

**生产模式**（打包后直接双击 Cloe.app，bridge 内嵌在 launcher.js 中自动启动，无需 Node.js/Python）

## 架构

```
┌─────────────┐     HTTP POST      ┌──────────────────────────┐    WebSocket    ┌─────────────┐
│   Any HTTP   │ ──────────────▶  │  launcher.js (Embedded   │ ──────────────▶ │   Electron   │
│   Client     │  :19851/action   │  WS+HTTP Bridge)         │   :19850        │  Renderer    │
│              │                   │  运行在 Electron Main    │                 │  (Browser)   │
│  curl / AI   │                   └──────────────────────────┘                 │  GIF Player  │
│  Agent       │                                                        │  Audio       │
└─────────────┘                                                        └─────────────┘
```

**注意**：renderer 连接 WS 地址是 `ws://127.0.0.1:19850`（根路径，**不带** `/ws`），bridge 监听根路径，没有 `/ws` 子路径。

### 文件职责

| 文件 | 职责 |
|------|------|
| `launcher.js` | **唯一入口**（dev/prod通用）：内嵌启动WS+HTTP bridge → 等待就绪 → 加载 action-sets.json → 创建窗口。`isDev`仅控制DevTools开关。**不再 fork 子进程** |
| `preload.js` | contextBridge暴露moveWindow API |
| `index.html` | 入口HTML，双缓冲 img#cloe-gif-a + img#cloe-gif-b + ws-status指示灯 |
| `src/renderer.js` | 核心逻辑：GIF播放/切换、idle循环、action处理、音频播放、WebSocket客户端。硬编码 GIF_ANIMATIONS 仅作启动初始值，收到 `set-config` 后被 action-sets.json 覆盖 |
| `src/style.css` | 透明背景、双缓冲层叠样式 |
| `public/action-sets.json` | **动作集清单**：定义多套动作集，每套含 id、名称、参考图、chromakey、动作列表、idlePlaylist、actionMap |
| `public/references/` | 各动作集的参考图（绿/蓝背景半身照） |
| `scripts/generate_gif.py` | 单个GIF生成脚本（旧版，i2v→chromakey→dehalo） |
| `scripts/generate_gif_v2.py` | 单个GIF生成脚本（推荐，支持绿/蓝幕，自动压缩大参考图） |
| `scripts/batch_generate_gifs.py` | 批量并行GIF生成（4个任务同时提交百炼API） |
| `reference_upperbody_greenbg.png` | 绿背景坐着半身照（idle/working 参考图） |
| `reference_upperbody_bluebg.png` | 蓝背景坐着半身照（**推荐**，GIF生成的参考图） |
| `build/icon.icns` | macOS应用图标（从可可自拍生成） |

### Embedded Bridge（内嵌在 launcher.js）

- WS server (`:19850`) + HTTP server (`:19851`) 直接运行在 Electron main process
- HTTP API:
  - `POST /action` — 触发动作（转发给所有 WS clients）
  - `GET /status` — 查看连接状态
  - `GET /action-sets` — 列出所有动作集摘要
  - `GET /action-sets/:id` — 查看单个动作集详情和动作列表
  - `GET /actions` — 返回 active set 的动作列表（backward compatible）
  - `GET /actions?set=xxx` — 返回指定 set 的动作列表
  - `POST /actions/preview` — 触发指定动作预览（等同 /action）
  - `PATCH /action-sets/:id/idle-playlist` — 更新单个动作 idle 配置，body: `{name, enabled, weight(1-10)}`
- WebSocket: 客户端连根路径 `ws://127.0.0.1:19850`（**不带 `/ws`**）
- **外部触发走 HTTP POST /action**，bridge 会转发给所有已连接的 WS clients
- **WS客户端直接发消息不会被转发**——bridge 只 log 不 broadcast，这是设计如此
- 如果已有实例在跑（端口被占），launcher 会检测到并跳过启动
- **为什么内嵌？** 打包后 `fork()` 用的是 Electron 二进制而非 Node.js，无法运行纯 Node 脚本。内嵌彻底消除了这个依赖问题。

## 当前可用动作（10个GIF + 2段TTS）

| Action | GIF | 触发方式 | 说明 |
|--------|-----|---------|------|
| `blink` | blink.gif | idle自动 | 眨眼 |
| `smile` | smile.gif | idle+触发 | 微笑 |
| `kiss` | kiss.gif | idle+触发 | 亲亲 |
| `nod` | nod.gif | idle+触发 | 点头赞同 |
| `wave` | wave.gif | 触发 | 挥手打招呼 |
| `think` | think.gif | idle+触发 | 歪头思考 |
| `tease` | tease.gif | 触发 | 眨眼坏笑 |
| `speak` | speak.gif | 触发+音频 | 嘴巴开合，可配TTS |
| `shake_head` | shake_head.gif | idle+触发 | 轻微摇头 |
| `working` | working.gif | hooks自动 | 敲键盘（working模式锁定） |

### Working/Idle 模式切换

Agent 执行任务时自动切换到 working 状态（敲键盘），任务完成后自动恢复 idle。

**renderer.js 逻辑：**
- `action: "working"` → 停止 idle 循环，锁定在 working.gif，`isWorking=true`
- `action: "idle"` → `isWorking=false`，恢复 idle 随机循环
- **working 模式下中间 action（smile/nod 等）播完后自动回到 working.gif**（3秒 REACTION_DURATION 后），不是停在 reaction GIF 上
- working 模式下 idle 循环完全暂停（`scheduleNextIdle` 和 `playRandomIdle` 检查 `isWorking`）

### 动作 Fallback 机制

当激活非默认动作集时，renderer 会同时持有 default set 的动画和 actionMap 作为 fallback：
- `broadcastSetConfig()` 对非 default set 会额外发送 `fallbackAnimations` 和 `fallbackActionMap`
- `handleAction()` 查找动作时：先查当前 set 的 ACTION_MAP → 没有 → 查 FALLBACK_ACTION_MAP（default）→ 都没有才 resetGif()
- 切到 cutekeke 后即使没有 wave/kiss 等动作，仍能从 default fallback 播放

### 动作管理界面（Action Manager, M1）+ 多套动作集

通过托盘图标唤出独立管理窗口，查看和预览所有动作。

**核心概念**：一个**动作集（action set）= 一套完整的角色形象**，包含 idle 动作 + working 动作 + 所有动作 + 自己的参考图。可以有多套形象（如校服可可、家居可可），按天切换或随时换。

**清单文件**：`public/action-sets.json`
```json
{
  "version": 1,
  "activeSetId": "default",
  "sets": [{
    "id": "default",
    "name": "默认", "nameEn": "Default",
    "description": "默认角色形象",
    "reference": "references/default.png",
    "chromakey": "green",
    "animations": { "blink": "gifs/blink.gif", ... "working": "gifs/working.gif" },
    "idlePlaylist": ["blink", "blink", "smile", "smile", "kiss", "think", "nod", "shake_head"],
    "actionMap": { "smile": "smile", "approve": "smile", "happy": "smile", ... }
  }]
}
```

**参考图目录**：`public/references/`，每套动作集放一张参考图。

**launcher.js 变更**：删除了硬编码的 `GIF_ANIMATIONS`/`IDLE_PLAYLIST`/`ACTION_MAP`，改为启动时从 `action-sets.json` 动态加载（`loadActionSets()`）。如果文件不存在，功能降级但不报错。

**⚠️ 打包后路径**：`loadActionSets()` 使用多候选路径查找（packaged 先找 `dist/action-sets.json`，dev 先找 `public/action-sets.json`），`app.isPackaged` 控制优先级。

**API**：
- `GET /action-sets` — 列出所有动作集（含参考图路径、动作数量、是否激活）
- `GET /action-sets/:id` — 获取指定动作集详情和动作列表
- `GET /actions` — backward compatible，返回 activeSet 的动作
- `GET /actions?set=xxx` — 按集查询动作
- `POST /actions/preview` — 触发指定动作
- `PATCH /action-sets/:id/idle-playlist` — 更新 idle 配置，body: `{name, enabled, weight}`

**文件**：`public/manager/index.html`、`public/manager/manager.css`、`public/manager/manager.js`、`public/manager/actions.js`、`public/manager/actions.css`

**功能**：
- 顶部形象选择器（横向 tab 按钮）
- **激活交互**：直接点击非激活 tab 即可切换激活（不需要单独的按钮）。已激活的 tab 点击只是切换查看详情
- 激活的 tab 有绿色渐变背景 + 绿色边框 + "使用中" badge（CSS class `active-set`），当前选中查看的 tab 额外有 `selected` class
- 非 active set 的 tab hover 时显示删除按钮（`×`），active set 不显示删除按钮
- 选中 set 后显示参考图信息（缩略图+描述+色幕类型+动作数）和动作卡片网格
- 点击参考图缩略图弹大图 modal（720px 宽）
- 卡片网格展示动作（缩略图、名称、触发方式、idle权重），点击预览实时触发

**⚠️ public/manager/ 下是普通 script，不是 ES module，不要用 import。**

**托盘**：launcher.js 新增 Tray，右键菜单"设置..."+ "退出 Cloe"。关闭所有窗口后 tray 保持运行不退出。

**管理窗口**：独立 BrowserWindow，普通窗口不影响主悬浮窗。开发模式直接加载 public/manager/，生产模式随 vite 打包到 dist/manager/。

**vite.config.js 变更**：`publicDir: false` 替换为自定义 Vite 插件 `copy-public-assets`，选择性拷贝 public/ 到 dist/，排除 _work_* 中间目录。确保 dist/gifs/、dist/audio/、dist/manager/ 都可用。

**两层触发架构（Hook + Plugin）：**

**Gateway Hook**（`~/.hermes/hooks/cloe-desktop/`）— 仅处理进程级事件：
- `agent:start` → working（锁定敲键盘 GIF）
- `agent:end` → idle（恢复 idle 循环）

**Hermes Plugin**（`~/.hermes/plugins/cloe-desktop/`）— 处理所有 session 级事件：
- 工具调用前后表情（tool_expressions / tool_completions）
- 用户消息关键词匹配（keyword_map）
- Session 开始/结束/重置（wave / kiss / shake_head）
- Context window 用量阈值（context_thresholds）
- Subagent 完成反馈（clap / shake_head）
- 触发规则从 `<dataDir>/plugin-rules.json` 读取，5秒缓存自动刷新
- Manager UI 的 "Plugin Rules" tab 可视化编辑规则

**修改 hook/plugin 后需要重启 gateway 才能生效。** `plugin-rules.json` 不用重启（热加载）。

**working GIF 设计**：键盘放在身前挡住白衣服，这样 chromakey 只处理绿色背景，白衣服不会被误杀。参考图用 `public/gifs/_work_idle/01_green_bg_sitting.png`（绿幕）。

### Idle循环

```
Weights: blink×2, smile×2, kiss×1, think×1, nod×1, shake_head×1
Interval: 8–15秒随机
Rule: 不连续重复同一动作；working模式下idle循环完全暂停
```

### Speak动作（带TTS音频）

两种触发方式，优先级从高到低：

```bash
# 1. 动态音频 — 通过 audio_url 播放远程/本地音频文件
curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://example.com/audio.mp3"}'

# 2. 预录语音（public/audio/ 目录下的文件）
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"done"}'
```

**注意**：TTS WebSocket 流式连接代码（connectTtsWebSocket / ttsSpeak）已于 2026-05-02 移除。不再需要本地 TTS Server 运行，也不再连接 :19853 端口。TTS 合成由 Hermes 侧完成，生成音频文件后通过 audio_url 传入播放。

预录音频（`public/audio/`，MOSI云端TTS音色 voice_id 2036257587296473088）：
- `doing.mp3`："小可爱，我这就去做"
- `done.mp3`："小可爱，做好了，你看看"

**添加新语音**：MOSI API生成wav → `ffmpeg -i input.wav -c:a libmp3lame -q:a 4 public/audio/xxx.mp3` → `{"action":"speak","audio":"xxx"}`

音频3秒后自动停止（跟随reaction duration）。

## GIF 双缓冲交叉淡入淡出

两个 `<img>` 层叠（A/B），CSS `position: absolute` + `transition: opacity 0.3s`。
切换流程：新GIF在隐藏层预加载 → 两层同时opacity过渡 → 旧层淡出，新层淡入。
防抖：`isTransitioning` + `pendingGif` 队列。`resetGif()` 操作当前 activeLayer。

## 快速生成新动作（三步，原始流程）

⚠️ **这是最早也最简单的流程。后来加了蓝幕/action-sets/管理界面等，不要搞混。**

### Step 1: 跑脚本生成 GIF（terminal 里跑，不是 execute_code）

```bash
cd ~/work/cloe-desktop

# 单个动作（绿幕参考图，去绿色 chromakey）
python3 scripts/generate_gif.py \
  --action <动作名> \
  --prompt "<中文描述女孩的动作，末尾加'纯绿色背景。电影质感，高清。'>" \
  --duration 5

# 批量生成（4个并行）：编辑 scripts/batch_generate_gifs.py 的 ACTIONS 字典后
python3 scripts/batch_generate_gifs.py
```

- **参考图已有**：`reference_upperbody_greenbg.png`，不用生成！不要用文生图重新生成参考图（人物一致性会崩）
- 脚本自动完成：参考图 → wan2.7-i2v → ffmpeg chromakey(绿) → Python 去绿色光晕 → GIF → 复制到 public/gifs/

### Step 2: 改 renderer.js（两处）

```js
// GIF_ANIMATIONS 加一条
clap: `${BASE}gifs/clap.gif`,
// ACTION_MAP 加一条
clap: 'clap',
```

### Step 3: 测试

```bash
curl -s http://localhost:19851/action -d '{"action":"clap"}'
```

### 原始流程注意事项

- **绿幕不是蓝幕**：原始流程用绿幕（`reference_upperbody_greenbg.png` + `chromakey=0x00FF00`），蓝幕和 v2 脚本是后来才加的
- **不需要生成参考图**：`reference_upperbody_greenbg.png` 早就有了，不要用文生图重新生成（人物一致性会崩）
- **action-sets 是后来的东西**：原始流程只改 renderer.js，action-sets.json 是后加的双轨机制

## GIF 生成 Pipeline（详细）

```
绿背景参考图 → wan2.7-i2v(视频) → ffmpeg chromakey(绿) → 透明GIF
```

### 背景色选择

**原始流程用绿幕**（`reference_upperbody_greenbg.png`）。v2 脚本也支持蓝幕（`--chromakey blue`）。

蓝幕的优势（可可特征：黑发 + 亚洲肤色 + 白色衣服）：
- 肤色蓝色分量最低、黑发与蓝色差异大、白衣服无关
- 绿幕的问题：黑头发暗色像素色相落在绿色范围被误杀，手指缝绿幕残留

如果只有绿背景参考图，可以用 Python 把绿色像素替换为蓝色：
```python
from PIL import Image; import numpy as np
img = Image.open('ref_green.png').convert('RGB'); arr = np.array(img)
r,g,b = arr[:,:,0],arr[:,:,1],arr[:,:,2]
mask = (g>100) & (g-r>60) & (g-b>60)
arr[mask] = [0,0,255]
Image.fromarray(arr).save('ref_blue.png')
```

### 关键API格式（wan2.7-i2v）
- **端点**：`video-generation/video-synthesis`
- **Header**：`X-DashScope-Async: enable`
- **Payload**：`input.media` 数组，`{"type": "first_frame", "url": "data:image/png;base64,..."}`
- **参数**：`resolution`（"720P"），不是 `size`
- **轮询**：`GET /api/v1/tasks/{task_id}`

### 参考图要求
- 坐着、双手自然放身前、俏皮表情、**纯蓝背景#0000FF**
- 上半身半身照（肩膀到腰部以上）
- **不要直立站立**——太僵硬
- 眨眼和微笑必须**分开做两个视频**
- **为什么用蓝幕不用绿幕**：可可特征是黑发+白衣服+亚洲肤色。绿幕反光导致头发被误杀（暗色像素色相落在绿色范围），白衣服和肤色跟绿区分度不够导致手指缝残留。蓝幕对这三者都有足够区分度。
- **生成蓝幕参考图**：如果只有绿幕参考图，可以用 Python 把绿色像素替换为蓝色，不需要重新调 image-pro API
- 已有蓝背景参考图：`reference_upperbody_bluebg.png`

### ffmpeg chromakey（两步法：先生成palette再生成GIF）

**蓝幕版**（推荐，对黑发+白衣服友好）：
```bash
ffmpeg -y -i input.mp4 \
  -vf "chromakey=0x0000FF:0.15:0.05,fps=10,scale=400:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png
ffmpeg -y -i input.mp4 -i palette.png \
  -lavfi "[0:v]chromakey=0x0000FF:0.15:0.05,fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  -loop 0 output.gif
```
**绿幕版**（旧，头发和手指缝去绿有残留问题，不推荐）：
```bash
ffmpeg -y -i input.mp4 \
  -vf "chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png
ffmpeg -y -i input.mp4 -i palette.png \
  -lavfi "[0:v]chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" \
  -loop 0 output.gif
```
- GIF保存：`disposal=2, optimize=False`（optimize可能破坏透明度）

### 命令速查（单条 / 批量）

**单条（`generate_gif.py` v1，绿幕最简单）**：
```bash
cd ~/work/cloe-desktop
python3 scripts/generate_gif.py \
  --action <动作名> \
  --prompt "<中文描述女孩的动作，纯绿色背景>" \
  --duration 5
```
- 参考图用已有 `reference_upperbody_greenbg.png`；输出自动到 `public/gifs/<动作名>.gif`；须在终端运行（PIL/numpy/scipy），不要用 execute_code。
- **批量**：编辑 `batch_generate_gifs.py` 的 `ACTIONS` 后执行 `python3 scripts/batch_generate_gifs.py`（4 路并行）。
- **蓝幕示例（v1，pout）**：`python3 scripts/generate_gif.py --action pout --prompt "她微微嘟起嘴唇，表情可爱委屈。身体保持不动。纯蓝色背景。电影质感，高清。"`

**⚠️ 已知质量问题（2026-05-01 实测 clap 动作）：**
- 绿幕 chromakey 会导致手部偏红（手的肤色在绿色背景下有绿色反射，去绿后红通道被放大），可接受范围内
- v2 脚本 `generate_gif_v2.py` 支持蓝幕和自动压缩参考图，一般不需要用。除非绿幕效果不好时再考虑

### ⚠️ vite.config.js publicDir 策略

**与 `pack.sh` 的关系**：若生产链路使用 **`publicDir: false`**，Vite **不会**自动把 `public/` 拷进 `dist/`，必须由 `pack.sh` 按「打包（electron-builder）」中的静态资源清单手动同步；管理界面不更新时优先检查 `public/manager/*` → `dist/manager/`。

**常见 dev 配置**：`publicDir: 'public'`（开发时正常 serve `public/`）；build 时由 Vite 先复制 `public/`，再在 `closeBundle` 用 `fs.rmSync` 清掉 `dist/gifs/_work_*`，避免中间产物进包。若整条链路改为 `publicDir: false`，开发侧需另有方式 serve `public/`，否则 GIF/音频 404。

```js
// vite.config.js 关键逻辑
publicDir: 'public',
plugins: [{
  name: 'copy-public-assets',
  apply: 'build',
  closeBundle() {
    const dest = path.resolve('dist');
    const skipDirs = ['_work_actions', '_work_idle', '_work_working', '_work_smile'];
    for (const dir of skipDirs) {
      const dirPath = path.join(dest, 'gifs', dir);
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
      }
    }
  },
}]
```

**添加新动作后需要更新的地方**：

1. `generate_gif.py` 已经自动把 GIF 复制到 `public/gifs/` 了，不用手动 cp
2. `public/action-sets.json` 对应 set 的 `animations` 加 `"pout": "gifs/pout.gif"` — **launcher 读清单**
3. `public/action-sets.json` 对应 set 的 `actionInfo` 加描述 — **Hermes 通过 API 读描述理解动作含义**
4. 通过 `POST /action-sets/default/generate-action` API 生成时，步骤 2-3 自动完成
5. 测试：`curl -s http://localhost:19851/action -d '{"action":"pout"}'`，确认生效
6. **不需要改 renderer.js**：renderer 启动时用硬编码初始化，launcher broadcast `set-config` 后直接覆盖 GIF_ANIMATIONS/ACTION_MAP/IDLE_PLAYLIST
7. 如果用的是 Cloe.app（生产版），通过 API 生成无需重新打包（文件系统方案：GIF 写 `~/.cloe/gifs/`，action-sets.json 在 userData，launcher 自动读到）

### 打包（electron-builder）

**版本与产物**
- v1.0.0，`package.json` 的 `"main": "launcher.js"`
- DMG：`release/Cloe-1.0.0-x64.dmg`（以 `package.json` / 实际产物为准）

**一键命令**
```bash
./scripts/pack.sh --dir   # 只生成 .app 目录（调试快，不打 DMG）
./scripts/pack.sh         # 完整构建并打 DMG
```

**一键打包 + 安装**（推荐，改完代码后必用）
```bash
./scripts/pack.sh --dir && ./scripts/install.sh
```

**打包踩坑总结**：
- `pack.sh` 会先 `rm -rf dist release` 全量重建，保证 asar 里是最新的代码
- `install.sh` 会先杀进程→删旧 App→拷贝新 App→启动→等待就绪
- **不要手动 `cp -R` 覆盖正在运行的 App**——macOS 可能不覆盖 asar，导致旧代码一直跑
- **`cp -R` 不加 `rm -rf` 也会失败**——必须先 `rm -rf /Applications/Cloe.app` 再拷贝
- `pack.sh` 会拷贝 `public/manager/`、`public/references/`、`public/action-sets.json` 到 dist/（打包后管理面板和动作集清单才能用）
- 改了 `public/manager/` 下的文件后必须重新打包才能在 Cloe.app 里看到变化（dev 模式不受影响）

**`pack.sh`**
- 每次构建前清理输出目录（如 `rm -rf dist release`），保证**全量重建**；脚本内对关键静态资源做**存在性/完整性校验**（以仓库内 `scripts/pack.sh` 为准）。
- **用 `scripts/pack.sh`，不要用 `npm run pack`**：若 npm 脚本没有同等「过滤 `_work_*` + 按清单拷贝」逻辑，会把中间产物打进包，DMG 爆肥。

**`install.sh`**
- 先结束 Cloe 进程 → 删除旧 `Cloe.app` → 拷贝新构建 → 启动应用 → 等待 bridge 就绪。

**⚠️ 不要用 `cp -R` 直接覆盖正在运行的 App**
- macOS 可能**不刷新 `app.asar`**，看起来像「打包了但界面/资源没变」。应退出应用，对安装目标 **`rm -rf` 旧 `.app`**，再拷入新包（`install.sh` 按此思路实现）。

**`vite.config.js` `publicDir: false`**
- 在该配置下 Vite **不会**自动把整棵 `public/` 同步进 `dist/`；静态资源必须由 **`pack.sh` 显式拷贝**（与上方「vite.config.js publicDir 策略」对照阅读）。

**`pack.sh` 静态资源清单（须与仓库脚本一致）**
- `public/gifs/`（成品 GIF）
- `public/audio/`
- `public/manager/` → `dist/manager/`
- `public/references/`
- `public/action-sets.json`
- `public/tray_icon.png`

**管理界面打包后没更新**
- 检查 `pack.sh` 是否把 `public/manager/*` 拷到 `dist/manager/`（`publicDir: false` 时 Vite 不会自动带过去）。

**electron-builder**
- **必须本地安装** `electron-builder`，用 **`./node_modules/.bin/electron-builder`** 调用；`npx` 可能找不到或版本漂移。
- 若报 `Cannot find module 'app-builder-bin'`，重新完整 `npm install`，确认 `node_modules/electron-builder` 与 `app-builder-bin` 齐备。

**DMG 体积（优化结论，实测约 2026-04）**
- `public/` 整树进 `dist` 时，`gifs/_work_*` 下视频、raw GIF、palette、rembg 帧等会让 DMG ~314MB；改为 `publicDir: false` + `pack.sh` 只拷成品与上表清单后，约 **128MB** 量级。

**签名 / Gatekeeper**
- 无 Apple 签名时需 `mac.hardenedRuntime: false`、`mac.gatekeeperAssess: false` 等（见下方 `package.json build`）；否则 macOS 可能拦截。证书缺失或过期会提示「无法验证开发者」，用户可右键「打开」绕过；正式发布走 Developer Program。

**Electron 下载**
- 首次打包需下载 Electron zip（~100MB）；可设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 加速，有时需 10–15 分钟。

**DMG → App（可选 CLI）**
- `hdiutil attach` → 拷贝 `.app` → `hdiutil detach`；写到 `/Applications` 等目标时仍须遵守「先退出、再 `rm -rf` 旧 `.app`、再拷新包」，避免覆盖运行中实例。

**打包踩坑 / 诊断（asar & 运行）**
- **electron-builder / app-builder-bin**：`npm install` 后确认二者齐备，否则 `Cannot find module 'app-builder-bin'`。
- **asar 缺 `launcher.js` / `preload.js`（历史问题）**：`npx asar list …/app.asar | grep -E '(launcher|preload)'`；改 main/preload 后必须重打包。
- **WS**：须 `ws://127.0.0.1:19850` **根路径**（不要 `/ws`）；`file://` + `localhost` / ES module CORS 曾导致 renderer 不执行（`clients=0`）— 以当前 `launcher.js` 的 `webSecurity` 等为准。
- **fork bridge**：打包后 `fork(ws_bridge_node.js)` 不可用，已改为 **bridge 内嵌 main**。
- **验证**：`npx asar list path/to/app.asar`；`clients=0` + chrome-error → JS 未加载；`clients=1` 不动 → 多见于 action/路径。
- **生产验证**从安装版 `Cloe.app` 启动；`lsof -i :19850 -P -n` 可看是否为 `*:19850`。
- **`--dir`**：只出 `.app`、不打 DMG，迭代更快。
- **整体包大小**仍以 Electron runtime 为主（历史记录约 **~400MB** 级 app，依依赖变化；删 three/VRM 后曾记 ~416MB）。
- **macOS 防火墙 / Tailscale**：可放行：
  ```bash
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /Applications/Cloe.app/Contents/MacOS/Cloe
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /Applications/Cloe.app/Contents/MacOS/Cloe
  ```
  或系统设置 → 网络 → 防火墙。**Tailscale IP 会变更**（`tailscale status`）。**Tailscale 桌面版 tun 与 Node**：外网 TCP 通但 HTTP/WS RST 时，换 **Homebrew userspace** 模式，见 `tailscale-userspace` skill。

### Icon 生成（build/icon.icns）

**推荐：`generate_icon.py`（参考 PNG）**
```bash
sips -z 1024 1024 ~/Pictures/cloe/REFERENCE.png --out /tmp/cloe_icon_src.png
python3 scripts/generate_icon.py --source /tmp/cloe_icon_src.png
# 输出 build/icon.icns
```
- 取图中心偏上约 **45% 高 × 55% 宽** 保头部；圆角半径约 **200**、白边 **6px**（以脚本为准）。示例参考：`~/Pictures/cloe/20260425_211659.png`。

**webp / 手工 iconset**
- Python 3.12 常不能直接读 webp，先 `sips -s format png …`，再裁正方形并生成各尺寸（16/32/128/256/512 + @2x），例如：
```bash
mkdir -p build/Cloe.iconset
sips -s format png -z 1024 1024 ~/.hermes/images/cloe.webp --out build/icon_1024.png
# …生成 iconset 各档…
iconutil -c icns build/Cloe.iconset -o build/icon.icns
```

### package.json build 配置要点
- `"main": "launcher.js"` — 生产模式入口（自动启动ws_bridge）
- `files`: 只打包 `dist/**/*`, `launcher.js`, `preload.js`, `node_modules/ws/**/*`
- `extraResources`: 无（bridge 已内嵌，不需要外部文件）
- `mac.target`: `dmg` + `x64`（Intel Mac）或 `arm64`（Apple Silicon）
- `mac.hardenedRuntime: false` — 无签名时必须关闭，否则macOS阻止运行
- `mac.gatekeeperAssess: false`
- `build/icon.icns` — PIL 生成圆角方形头像，iconutil 转 icns

### 启动流程（生产 vs 开发）

| 模式 | 入口 | ws_bridge | 加载页面 |
|------|------|-----------|---------|
| 开发 | `launcher.js` | 自动启动（内嵌） | `http://localhost:5173`（Vite dev server） |
| 生产 | `launcher.js` | 自动启动（内嵌） | `dist/index.html`（file://） |

launcher.js 启动顺序：`startBridge()` → `waitForBridge(3s)` → `createWindow()`。
如果已有实例在运行（端口被占），跳过启动。

**重要**：
- `launcher.js` 是**唯一的入口**（package.json `"main": "launcher.js"`）
- 开发模式：`npm run dev`（自动启动 Vite + Electron + DevTools）
- 生产验证**必须从 /Applications/Cloe.app 启动**，不能只跑 `npx electron .`（那是 dev 模式）
- `publicDir` / `_work_*` 清理策略见「vite.config.js publicDir 策略」；Gateway hook 与 config.yaml shell hooks 之别见上文「Gateway Lifecycle Hook 实现」。

### 动作集清单（action-sets.json）— 多形象支持

**概念**：一套动作集 = 一个完整的角色形象，包含 idle 动作 + working 动作 + 所有动作 + 自己的参考图。比如"校服可可"是一套，"家居可可"是另一套，可以按天切换或者随时换。**不是把 idle 和 working 拆成两套！**

launcher.js **不再硬编码 GIF_ANIMATIONS/IDLE_PLAYLIST/ACTION_MAP**，改为启动时从 `public/action-sets.json` 加载。renderer.js 启动时用硬编码初始化，但 launcher 启动后 broadcast `set-config` 消息，renderer 收到后直接覆盖 GIF_ANIMATIONS/ACTION_MAP/IDLE_PLAYLIST。运行时完全由 action-sets.json 驱动。

**清单格式** (`public/action-sets.json`)：
```json
{
  "version": 1,
  "activeSetId": "default",
  "sets": [
    {
      "id": "default",
      "name": "默认",
      "nameEn": "Default",
      "reference": "references/default.png",
      "chromakey": "green",
      "description": "默认角色形象",
      "descriptionEn": "Default character appearance",
      "animations": {
        "blink": "gifs/blink.gif",
        "smile": "gifs/smile.gif",
        "working": "gifs/working.gif"
      },
      "actionInfo": {
        "smile": {
          "description": "微笑，用于开心、赞同、被夸的时候",
          "descriptionEn": "Smile — happiness, agreement, being praised"
        }
      },
      "idlePlaylist": ["blink", "blink", "smile", "smile"],
      "actionMap": {
        "smile": "smile", "approve": "smile", "happy": "smile"
      }
    }
  ]
}
```

**各字段说明**：
- `id`：唯一标识，用于 API 查询
- `reference`：参考图路径（相对于 public/ 目录），在管理界面展示
- `chromakey`：色幕类型（green/blue），管理界面显示
- `animations`：动作名→GIF路径映射（**注意字段名是 `animations` 不是 `actions`**）
- `actionInfo`：动作语义描述（可选），`description` 中文 + `descriptionEn` 英文，供 AI agent 理解每个动作的含义和使用场景
- `idlePlaylist`：idle 随机播放列表（可重复表示权重）
- `actionMap`：外部触发名→内部 GIF 名的映射（如 approve→smile）

**当前已有的动作集**：
- `default`（默认）— 10 个动作：blink/smile/kiss/nod/wave/think/tease/speak/shake_head/working

**如何新增一套角色形象**：
1. 生成全套 GIF（idle + working）并放到 `public/gifs/` 目录
2. 参考图放到 `public/references/` 目录
3. 编辑 `public/action-sets.json` 加一个 set 对象（包含全部动作，不只是 idle 或 working）
4. 重启 Cloe Desktop 使 launcher 重新加载清单并 broadcast set-config
5. **不需要改 renderer.js**：renderer 收到 set-config 后自动覆盖 GIF_ANIMATIONS/ACTION_MAP/IDLE_PLAYLIST

**⚠️ 动作定义由 action-sets.json 驱动**：launcher 启动时 broadcast `set-config`，renderer 收到后用清单内容覆盖硬编码初始值。通过 API 生成新动作时（`POST /action-sets/:id/generate-action`），完成后自动更新 action-sets.json 并 broadcast，renderer 无需改代码、无需重新打包。

**⚠️ Fairy review 踩坑（2026-04-30）**：
1. **打包路径**：action-sets.json 路径在 packaged 环境找不到 → 改为多候选路径（`dist/` 和 `public/` 都试）
2. **TTS error 打破 working lock**：renderer.js TTS error 分支直接 `startIdleLoop()` 没判断 working 状态 → 改成跟 done 分支一致（根据 `ttsPrevWorking` 恢复）
3. **vite publicDir 双重复制**：Vite 先复制 public/（含 `_work_*`），自定义插件再复制+过滤是第二次，第一次已经污染了 dist → 改为 build 后 `rmSync` 清理

### Action Manager / Settings 面板（2026-04-30）

管理入口：系统托盘图标 → "设置..."（不要用 emoji，macOS 原生菜单不支持 emoji 显示）。

**文件结构**：
```
public/manager/
├── index.html        # 设置面板主页面（侧边栏 + 内容区域布局）
├── manager.css       # 主样式（侧边栏、tab 导航、整体暗色主题）
├── manager.js        # Tab 切换入口 + i18n 初始化
├── i18n.js           # 国际化模块（自动检测系统语言，localStorage 持久化）
├── locales/
│   ├── zh-CN.json    # 中文翻译
│   └── en-US.json    # 英文翻译
├── actions.js        # 动作管理 tab 逻辑（含动作集切换）
├── actions.css       # 动作管理 tab 样式（含 set tabs + 参考图）
└── preferences.js    # 偏好设置 tab（语言切换、通用设置）
```

**架构**：
- 左侧 sidebar（200px）+ 右侧内容面板，macOS 风格
- Tab：动作管理 + 偏好设置（语言、通用设置）
- **动作集选择器**（set tabs）：顶部横向 tab 按钮，每个代表一个完整角色形象，当前激活的 set 按钮带参考图缩略图
- **参考图展示**：选中 set 后显示 72×72 缩略图 + 描述 + chromakey 类型，点击可弹窗查看大图（720px modal）
- 语言切换放在偏好设置 tab 中（macOS 分段控制器）
- 窗口大小 ~800x600

**API**：
- `GET /action-sets` — 列出所有动作集摘要（id/name/reference/actionCount/active）
- `GET /action-sets/:id` — 查看单个动作集详情和动作列表
- `GET /actions` — 返回 active set 的动作列表（backward compatible）
- `GET /actions?set=xxx` — 返回指定 set 的动作列表
- `POST /actions/preview` — 触发指定动作预览

**launcher.js 变更**：
- `loadActionSets()` — 启动时从 action-sets.json 加载清单
- `getActiveSet()` — 获取当前激活的 set
- `getSetById(setId)` — 获取指定 set 的完整配置
- `buildActionsList(setId)` — 根据 set 生成动作列表（含 trigger/idleWeight 分类），无参返回 active set
- `buildSetsSummary()` — 生成所有 set 的轻量摘要
- Tray + Menu + nativeImage（托盘图标）

### 2026-04-28 代码清理（重构后架构）

- **删除了 `electron.js`**：旧版 main process，被 launcher.js 完全替代
- **删除了 `ws_bridge.py`**：Python 版 bridge，早已不用
- **删除了 `ws_bridge_node.js`**：独立 Node bridge 文件，逻辑已内嵌到 launcher.js
- **删除了 `~/.hermes/agent-hooks/` 目录和 config.yaml 里的 hooks 配置**：pre_tool_call/post_tool_call shell hooks 不可靠，已被 gateway lifecycle hooks（`~/.hermes/hooks/cloe-desktop/handler.py`）完全替代。
- **renderer.js 提取 ACTION_MAP**：统一 action→GIF 映射，减少 switch-case 重复
- **.gitignore 加 `public/gifs/_work_*/`**：排除 GIF 生成中间产物
- **净减 ~400 行代码**，功能完全不变

### Gateway Lifecycle Hooks（不是 config.yaml hooks）

Cloe Desktop 的动画触发**只**走 **`~/.hermes/hooks/cloe-desktop/handler.py`**（配 `HOOK.yaml`），**不是** config.yaml 里的 `hooks:`（`pre_tool_call` / `post_tool_call`）。shell hook、`~/.hermes/agent-hooks/` 等已清理，**勿混用两套**。

| 事件 | 触发时机 | 动作 |
|------|---------|------|
| `agent:start` | 智能体 / agent 开始处理或执行 | `working`（敲键盘 GIF，锁定模式） |
| `agent:end` | 处理或执行完毕 | `idle`（恢复 idle 循环） |
| `agent:error` | agent 崩溃或被中断 | `idle`（兜底恢复） |
| `session:start` | 新会话 | `wave` |
| `session:end` | 会话结束 | `idle` + `kiss`（强制 idle 兜底） |

- `handler.py` 的 `handle(event_type, context)` 订阅上表事件；gateway 收到事件会调用匹配 handler。
- **改 `handler.py` 后须重启 gateway**；若有 `__pycache__` 可删掉再启。
- 更细的说明见上文「Gateway Lifecycle Hook 实现（~/.hermes/hooks/cloe-desktop/）」。

### 等待用户输入状态（未实现）

- gateway 模式下 AIAgent 没有传 `clarify_callback`，clarify 工具直接返回错误
- 不存在"agent 在等待用户回答"的中间状态，只有 start 和 end
- 要支持需改 Hermes gateway 源码：传 clarify_callback + 新增 `agent:waiting` 事件

### Context 使用占比（未实现）

- gateway `/usage` 命令能拿到 `ctx.last_prompt_tokens / ctx.context_length`
- 但 hook context 里没传这些数据，需改 `run.py` emit `agent:end` 时多加字段

### Bridge API 测试（25 个，秒级）
```bash
# 需要先启动 app（npm run dev 或打开 Cloe.app）
npm run test:bridge
```
覆盖：HTTP status/action/404/CORS/空body、WS connect/disconnect/消息转发、9个动作全覆盖。

### 视觉冒烟测试（截图回归，发飞书人工验证）
```bash
npm run test:smoke      # 测试 /Applications/Cloe.app（安装版）
npm run test:smoke:dev   # 测试 dev server（vite + electron）
```
自动找窗口位置 → 逐个发 action → 等 crossfade → 截图区域 → 上传飞书。

**改完代码后两个都要跑**：`test:bridge` 保证 API 没坏，`test:smoke:dev` 保证视觉效果没坏。

### 窗口位置记忆（2026-05-01）

用户可在管理界面"偏好设置"中保存当前桌面角色的位置，下次启动自动恢复。

**配置文件**：`window-position.json`（打包 → userData，dev → 项目根 `.window-position.json`）

**HTTP API**：
- `GET /window-position` — 返回 `{ saved: {x,y}|null, current: {x,y} }`
- `POST /window-position` — body `{x,y}` 保存位置，body `{clear:true}` 清除

**launcher.js 函数**：`loadWindowPosition()`、`saveWindowPosition()`、`clearSavedWindowPosition()`、`getInitialMainWindowXY(ww,wh)`

**边界检查**：启动时用 `screen.getPrimaryDisplay().workArea` 校验，超出范围 fallback 到右下角。

### 增强版去蓝色光晕脚本（HSV色相分析）

`scripts/fix_blue_fringe.py` — 对已有 `_raw.gif` 重新去蓝色，不需要重新生成视频。

### rembg 方案（不推荐，仅供参考）

**不推荐原因**：
- **u2net**（176MB）：模型从 GitHub 下载，国内被墙需 VPN。每帧 ~10s CPU。
- **bria-rmbg-2.0**（977MB）：CPU 每帧 ~34s，Intel Mac 50帧要近30分钟。且通用背景去除对绿幕/蓝幕素材效果反而不如 chromakey。
- 通用模型不知道背景是什么颜色，容易误判前景边缘。
- **结论：蓝幕 + ffmpeg chromakey 是最佳方案，不需要 rembg。**

**环境**：Python 3.12 (`/Library/Frameworks/Python.framework/Versions/3.12/bin/python3`)
- rembg CLI 有依赖问题（缺 asyncer/watchdog），**必须用 Python API**
- 如果需要用：`pip install rembg` + `pip install watchdog asyncer`
- **绕过下载机制**：手动下载模型到 `~/.u2net/u2net.onnx`，或直接用 onnxruntime 加载

**v2 关键改进：HSV色相检测**
- 用向量化的 RGB→HSV 转换，检测色相在 60°-180°（黄绿到青绿）的像素
- 结合饱和度 + g-excess 做双重判断，比单纯 g-excess 更精确
- 三层处理：强绿色(hue+sat+g_excess)→透明 / 中等(手指缝混合色)→去色+渐进alpha衰减 / 轻微边缘→色彩修正
- dilation iterations 4-6（generate_gif.py 内置版只有 2-3）

### 去背景方案对比（2026-04-28 实测）

在 Intel Mac 上对蓝幕挥手视频第35帧测试了4种方案：

| 方法 | 说明 | 效果 | 速度 |
|------|------|------|------|
| M1 chromakey基础 | ffmpeg chromakey=0x0000FF | 背景干净，手指缝有蓝色残留 | 实时 |
| M2 chromakey+去蓝光晕 | M1 + dilation + 颜色修正 + alpha fade | 手指缝改善明显 | 实时 |
| M3 HSV色相检测 | RGB→HSV hue 200-270检测蓝色 | 类似M2，边缘更平滑 | 实时 |
| M4 OpenCV GrabCut | 不依赖颜色，纯空间分割 | 边缘最自然，但可能切掉一些前景 | ~0.5s/帧 |
| rembg (u2net/bria) | AI通用背景去除 | **不推荐**，对手指缝色幕素材效果反而不如chromakey | 10-34s/帧 |

**结论：蓝幕 + ffmpeg chromakey (M1) 即可满足日常需求。如需精细处理，用 M2（去蓝光晕）或 M4（GrabCut）。rembg 不适用于色幕素材。**

## 开发注意事项

- **开发用分开的 Vite + Electron**：不依赖 `npm run dev`，手动 `npx vite --port 5173` + `npx electron .`
- **手动测试**：`npm run build && npx electron .`（注意这是 dev 模式，会连 Vite dev server）
- **生产验证必须安装 /Applications/Cloe.app 后测试**：`npx electron .` 走 dev 模式，行为不同
- **Vite端口**：5173
- **WS端口**：19850，**HTTP端口**：19851
- **检查连接**：`curl -s http://localhost:19851/status` → `{"clients":1}` 表示Electron已连接
- **百炼API欠费**：返回 `Arrearage - Access denied`，需去阿里云控制台充值
- **urllib.request POST dashscope会400**：必须用 `requests` 库
- **GIF切换alt文字闪现**：桌面GIF应设 `alt=""`

## 打包版（Cloe.app）文件系统架构

asar 是只读的。Electron 把 app 打进 .asar 归档文件，运行时通过 fs patch 读取，但所有写操作都必须写到 userData 目录。

### 路径映射

| 用途 | dev 模式 | 打包模式 |
|------|---------|---------|
| Python 脚本 | `__dirname/scripts/` | `process.resourcesPath/scripts/` (extraResources) |
| GIF 输出 | `public/gifs/` | `userData/gifs/` |
| 参考图(读) | `public/references/` | asar 内 `dist/references/` |
| 参考图(写) | `public/references/` | `userData/assets/references/` |
| action-sets.json | `public/action-sets.json` | `userData/action-sets.json` (首次从 asar 复制) |
| 参考图给 Python | 直接路径 | 复制到 `userData/tmp/ref_*.png` |

### 关键路径函数（launcher.js）

- `getScriptsDir()` — 打包: `process.resourcesPath/scripts/` | dev: `__dirname/scripts/`
- `getGifsDataDir()` — 打包: `userData/gifs/` (自动 mkdir) | dev: `public/gifs/`
- `getWritableAssetsRoot()` — 打包: `userData/assets/` | dev: `public/`
- `getPublicAssetsRoot()` — 打包: `__dirname/dist/` (asar 内，只读) | dev: `public/`
- `getActionSetsPath()` — 打包: `userData/action-sets.json` | dev: `public/action-sets.json`
- `resolveReferenceForPython()` — 路径含 ".asar" 时先 copyFileSync 到 tmp

### 打包模式资源加载

renderer.js 和 actions.js 在打包模式下通过 bridge HTTP 加载资源，不走 file:// 协议。bridge HTTP 提供静态文件路由 `/gifs/:name`、`/audio/:name`、`/references/:name`，搜索顺序：writableRoot → bundledRoot (asar)。

### package.json extraResources

scripts 目录放在 asar 外面：`{ "from": "scripts", "to": "scripts", "filter": ["**/*.py"] }`

### loadActionSets() 首次启动

打包模式首次启动，从 asar 内 dist/action-sets.json 复制到 userData/action-sets.json。后续读写走 userData。重置则删该文件。

### asar 踩坑

- spawn Python 路径用 `getScriptsDir()` 不能用 `__dirname`
- spawn cwd 用 `getGifsDataDir()` 不能用 `__dirname`
- saveActionSets() 写 userData 路径，写 asar 内会静默失败
- 参考图给 Python 用 `resolveReferenceForPython()` 先复制到 tmp
- Electron fs.existsSync 能读 asar 内文件，但 Python/ffmpeg 等外部进程不行

## M2 自动化 GIF 生成（2026-04-30）

### API Key 配置

- **存储位置**: `~/.cloe-desktop/config.json`（不进 asar、不存 localStorage）
- **读写 API**: `GET /api-config`, `POST /api-config`
- **字段**: `dashscopeApiKey`（百炼统一key）, `videoModel`（默认 `wan2.7-i2v`）
- **降级链**: config.json → `~/.hermes/.env` 的 `BAILIAN_API_KEY`
- **UI**: 偏好设置 tab 新增"API 配置" section，password input + 眼睛按钮切换明文

### 异步 GIF 生成 API

**`POST /action-sets/:id/generate-action`** — 异步，立即返回 202 + taskId
- Body: `{ name, prompt, duration? (3|5), chromakey?, trigger? }`
- 后台 spawn `scripts/generate_gif_v2.py`，环境变量注入 `BAILIAN_API_KEY`
- 参考图路径: `resolveReferenceAbsolutePath(set)` — set.reference → _work_idle fallback → __dirname fallback
- 超时 10 分钟，先 SIGTERM 再 SIGKILL
- 完成后自动更新 action-sets.json + broadcastSetConfig

**`POST /action-sets/generate-reference`** — 同步生成绿幕/蓝幕参考图
- Body: `{ chromakey: "green"|"blue", prompt? }`
- 用 `wan2.7-image-pro`（跟 cloe-moment 同模型，角色一致性最好）+ 参考图 + 强提示词
- 默认 prompt: `参考这张照片，完全保持人物的长相、五官、发型、肤色、衣服、表情、姿势和构图不变，只把背景替换为#00FF00纯绿色的纯色背景，方便后续抠图。不要改变人物的任何细节，不要改变衣服的颜色。`
- **为什么不用 `wanx2.1-imageedit`**：实测 description_edit 功能并不能"只换背景"，它仍然会重新生成整张图，人物/衣服都会变。`wan2.7-image-pro` 配合强提示词 + thinking_mode 才能保持人物不变只换背景。
- 同步 API，~10s 返回结果，直接广播 base64 图片
- API 端点: `multimodal-generation/generation`，同步调用（wan2.7-image-pro）
- 参数: `{ n: 1, watermark: false, thinking_mode: true }` — thinking_mode 帮助模型更好地遵循"只换背景"指令
- ⚠️ 不要用文生图模型重新画！旧方案会把衣服也染成绿/蓝色，导致 chromakey 误扣

**WS 异步通知**（管理窗口独立 WS 连接 ws://127.0.0.1:19850）:
- `generation-progress` — `{ taskId, status, progress }`
- `generation-complete` — `{ taskId, actionName, setId }`
- `generation-error` — `{ taskId, error }`
- `reference-generated` — `{ taskId, imageBase64, chromakey }`

**任务状态查询**: `GET /generation-tasks`, `GET /generation-tasks/:taskId`

### 管理窗口前端改造

- Add Action Modal 双模式: AI 生成（prompt + 时长）/ 手动上传（GIF 文件）
- Create Set Modal: 参考图预览下方增加"AI 生成绿幕/蓝幕参考图"按钮
- `syncAddActionGenUi()` 切换 AI/手动 UI 显隐和按钮文案

### Python 脚本变更

- `get_env()`: 先读 `os.environ`（spawn 注入优先），再读 `~/.hermes/.env`

### launcher.js 关键辅助函数

- `requestUrlBuffer()` — 通用 HTTPS GET/POST，支持跟随重定向（Node.js 内置 https 模块，无外部依赖）
- `dashScopeJson()` — 百炼 API 调用封装（自动带 X-DashScope-Async + Authorization）
- `dashScopeTaskGet()` — 百炼任务轮询
- `resolveReferenceAbsolutePath()` — 多候选路径查找参考图
- `mergeGenerateActionIntoSet()` — GIF 生成完成后更新 set 的 animations/actionMap/idlePlaylist

### ⚠️ 参考图生成 API 方案对比（2026-05-01）

**当前方案（有问题）**：`wan2.7-image-pro` 多模态文生图
- 输入：参考图 + prompt "纯绿色背景…"
- 问题：模型**重新画整张图**，衣服颜色也会跟着背景走变成绿色/蓝色，后续 chromakey 把衣服也扣掉了

**推荐方案（待实现）**：`wanx2.1-imageedit` 图像编辑
- function: `description_edit`（指令编辑，无需 mask）
- prompt: `"将背景替换为纯绿色(#00FF00)"` / `"将背景替换为纯蓝色(#0000FF)"`
- base_image_url: 用户上传的照片
- strength: 0.5（控制修改幅度，越小越接近原图）
- 优点：**只改背景，人物/衣服/表情全部保持原样**
- 异步 API：`POST /api/v1/services/aigc/image2image/image-synthesis`，0.14元/张
- 请求格式：`{"model":"wanx2.1-imageedit","input":{"function":"description_edit","prompt":"将背景替换为纯绿色(#00FF00)","base_image_url":"data:image/png;base64,..."},"parameters":{"n":1,"strength":0.5}}`
- 响应跟异步文生图一样：轮询 task_id → output.results[0].url

### 窗口位置记忆功能（2026-05-01）

- 位置存到 `~/.cloe/window-position.json`（跟 config.json 同目录，不用 userData）
- HTTP API：`GET/POST /window-position`（GET 返回 saved+current，POST 保存或 `{clear:true}` 清除）
- `getInitialMainWindowXY()` 宽松边界检查：只排除极端值（>2x 屏幕尺寸），允许负坐标
- macOS 允许窗口部分超出屏幕边缘（负 x/y），**不能用严格检查** `saved.x < wa.x`

### 注意事项

- launcher.js 用 Node.js 内置 `https` 模块，不引入外部依赖
- 千问 API 响应格式有多种 fallback 解析（results/url、render_urls、choices 等），实际格式需实测确认
- `public/manager/` 下是普通 script，不是 ES module
- Python 路径: `/usr/local/bin/python3`，ffmpeg 通过 PATH 可找到

## VRM/3D方案（远期储备，当前不活跃）

- **已放弃VRM路线**：VRM生态以二次元为主，真人模型稀缺，MToon材质专为卡通设计
- **3D方案远期用Godot**：原生3D渲染强，不混Electron
- **Gaussian Splatting**值得关注：Khronos正在标准化glTF扩展
- 详见旧版SKILL.md git history
