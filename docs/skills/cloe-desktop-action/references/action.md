# 动作触发、TTS 语音、GIF 生成

通过 HTTP API 发现和触发 Cloe 桌面角色的表情动作动画。

## 动态发现可用动作

**不要硬编码动作列表。** 通过 API 实时获取：

```bash
curl -s http://localhost:19851/actions
curl -s http://localhost:19851/action-sets
```

`GET /actions` 返回含 `name`、`description`、`hookNames`、`special` 等字段的动作列表。

## 触发动作

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

动作播放约 3 秒后自动恢复 idle 循环。

## 系统动作

| 动作 | 说明 |
|------|------|
| `working` | 敲键盘，锁定工作模式 |
| `idle` | 恢复 idle 循环 |
| `wave` | 新会话打招呼 |
| `kiss` | 会话结束 |

## 语音动作（speak）

> **Hermes 语音对话模式下的 TTS 策略**：Hermes 自带 TTS（前端/后端）会导致重复播放——前端按句子拆分调用多次 TTS，后端每 turn 调一次。**语音输出统一用 `generate_tts.py --speak`**（走 Cloe Desktop bridge），不依赖 Hermes 内置 TTS。详见 `hermes-voice-setup` skill 的"三重播放坑"章节。
>
> **语音对话节奏**：用户用 Ctrl+B 语音输入 → Whisper 转文字 → Agent 回复 → Agent 手动调 `--speak` 播放语音。每轮对话只调一次 `--speak`，不要同时触发 Hermes 的自动 TTS。

### 方式一：TTS 动态语音（推荐）

链路：`generate_tts.py` 生成 MP3 → 保存到 `~/.cloe/audio_cache/` → bridge `/tts/` 路由 serve → speak 播放。

```bash
# 生成 + 自动触发桌面 speak 播放
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "要说的话" --speak

# 仅生成音频（输出 MP3 路径到 stdout）
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "要说的话"

# 指定输出路径
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "要说的话" --output /tmp/custom.mp3

# 强制指定 provider
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "要说的话" --provider cosyvoice
```

stdout 只输出 MP3 文件路径，日志输出到 stderr。

#### TTS 配置

配置文件：`~/.cloe/tts-config.json`

```json
{
  "provider": "mosi",
  "mosi": {
    "api_key": "***",
    "voice_id": "2036257587296473088",
    "url": "https://studio.mosi.cn/v1/audio/tts"
  },
  "cosyvoice": {
    "api_key_env": "BAILIAN_API_KEY",
    "model": "cosyvoice-v1",
    "voice": "longmiao"
  }
}
```

- `mosi` — MOSI 云端 TTS（快 ~3s）**← 默认**
- `cosyvoice` — 阿里云 CosyVoice（多音色可选）

#### MOSI API 调用规范

脚本已封装，一般不需要手动调。如需手动：

```python
headers = {
    "Authorization": f"Bearer {api_key}",  # 必须用 Bearer auth
    "Content-Type": "application/json",
}
payload = {
    "model": "moss-tts",        # 必须有
    "text": text,
    "voice_id": voice_id,
    "sampling_params": {"temperature": 1.7, "top_p": 0.8, "top_k": 25},
}
```

#### 播放要点

- TTS 文本用完整连贯句子，少用省略号/波浪号
- MOSI 返回 WAV，脚本自动转 MP3（Electron `new Audio()` 播放 WAV 不完整）
- 手动 speak 已有音频：`curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>.mp3"}'`
- **speak 播放期间其他 action 被 drop，另一个 speak 可覆盖**——长内容合并成一句 TTS 一次发完

### 方式二：预录语音（`audio` 字段）

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
```

预录文件存放在 `~/.cloe/audio_cache/`。现有：`doing.mp3`、`done.mp3`。
添加新语音：TTS 生成 → `ffmpeg` 转 mp3 → 放 `~/.cloe/audio_cache/`。

### 方式三：data URL（短音频，<5s）

base64 编码后传 `data:audio/mpeg;base64,...`，curl 上限约 128KB。

## GIF 生成新动作

完整链路：参考图 → AI 视频 → chromakey → 透明 GIF。

```bash
# 单个生成（默认绿幕，输出到 ~/.cloe/gifs/{action}.gif）
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_gif_v2.py \
  --action pout \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。电影质感，高清。"

# 蓝幕模式（对黑发效果更好）
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_gif_v2.py \
  --action pout \
  --prompt "..." --chromakey blue

# 指定参考图
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_gif_v2.py \
  --action wave \
  --prompt "..." --reference ~/.cloe/references/default.png
```

脚本自动完成：压缩参考图 → pad 加宽 → 百炼 wan2.7-i2v 生成视频 → ffmpeg chromakey → 去色晕 → 透明 GIF → 复制到 `~/.cloe/gifs/`。

### 生成后注册动作（脚本不会自动注册！）

在活跃 set（通常是 `default`）中需要更新 **三个** 地方：

1. **`animations`** — 动作名映射到 GIF 路径：
   ```json
   "pout": "gifs/pout.gif"
   ```
2. **`actionInfo`** — 动作描述元数据：
   ```json
   "pout": { "description": "嘟嘴", "descriptionEn": "Pout" }
   ```
3. **`actionMap`** — hook 名映射到动作名（**hook 触发的动作必须加，否则不会响应触发！**）：
   ```json
   "pout": "pout"
   ```
   > 如果省略 `actionMap` 条目，动作虽然出现在 `/actions` 列表中但 hook 触发时不会播放。

注册完成后：
- Cloe 自动监听文件变化重载，无需重启
- 验证：`curl -s http://localhost:19851/actions` 检查新动作
- 测试：`curl -s http://localhost:19851/action -d '{"action":"pout"}'`

> ⚠️ 只复制 GIF 到 `~/.cloe/gifs/` 不够——必须同时更新 action-sets.json 的三个字段。

**推荐用脚本自动注册**（避免手动编辑 JSON 出错）：
```bash
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/register_action.py \
  --action pout \
  --description "嘟嘴" \
  --description-en "Pout" \
  --trigger hook   # hook 或 idle
```
脚本会自动添加 animations + actionInfo + actionMap 三项，并处理 `idlePlaylist`（trigger=idle 时加入）。

### Prompt 写法要点

- **身体保持不动**：只描述头部/上半身微动作（大幅度动作如跳舞除外）
- **确保人物完整在画面内**：脚本已内置 `pad_reference_to_wider()` 自动将竖屏参考图两侧填充色幕变成 0.75 宽幅（1482×2829→2121×2829），最终 GIF 输出 400×534
- **色幕一致性**：pad 填充的颜色与 `--chromakey` 一致。用 `--chromakey blue` 时脚本自动调 `convert_chroma_color()` 将绿幕参考图转成蓝幕再 pad
- **避开百炼审查**：不要在 prompt 写"纯绿色背景"（触发 `Green net check`）。`prompt_extend=False` 已关闭。prompt 避开"胸前""双手"等敏感词
- **电影质感，高清**：提高生成质量
- 时长一般 3-5 秒

### 清晰度优化要点

GIF 模糊的根因是**参考图被压缩太多 + 视频分辨率太低**。生成链路中的关键参数：

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `compress_image` 长边上限 | **1920px** | pad 后参考图更大（1482→2121px宽），压缩到 1280 会让角色只剩 670px，模糊 |
| 视频分辨率 | **1080P** | 720P 输出的角色像素不足，1080P 下 GIF 清晰度显著提升 |
| pad target_ratio | **0.75** | 1.0 正方形面积太大导致角色像素被稀释；0.75 在留空间和保持清晰度间取得平衡 |
| ffmpeg scale | `400:-1` | 固定 400px 宽，高度自适应比例（0.75 → 533px） |

> ⚠️ **三参数联动**：改 pad 比例必须同时考虑 compress 上限和视频分辨率。pad 面积越大 → 压缩后角色越小 → 视频分辨率越重要。

> ⚠️ **临时文件清理顺序**：`generate_video()` 中必须先 `open(compressed_path)` 读到内存 base64，再 `os.unlink()` 删临时文件。反过来会导致 FileNotFoundError。

### 窗口尺寸与 GIF 裁切

GIF 尺寸随生成比例变化（旧竖屏 400×764，新 0.75 比例 400×534）。窗口 `BASE_WIDTH` 和 `BASE_HEIGHT` 必须考虑三个因素：

1. **GIF 像素尺寸**（宽度 400px 是基准）
2. **characterPosition.x**（角色偏右时右侧空间 = width × (1-x)，需 > GIF显示宽度）
3. **characterSize.scale**（scale=1.2 时角色实际宽度 = 400×1.2=480px）

当前配置：`BASE_WIDTH=640, position.x=0.65, scale=1.2` → 右侧空间 = 640×0.35=224px > 480px（不够！实际靠 GIF 比例变窄补足）。

### GIF 缓存问题（Chromium file:// 缓存）

打包版通过 `file://` 协议加载 GIF。Chromium 按完整 URL 缓存图片，当 `~/.cloe/gifs/xxx.gif` 文件被替换后，URL 不变，Chromium 返回缓存的旧版。

**解决方案**（已在 renderer.js 实现）：`preloadGif()` 给 URL 加 `?v=N` 版本号，每次 `set-config`（action-sets 热加载）时 `_gifVersion++`，强制重新从磁盘加载。

### 生成脚本踩坑记录

**1. 百炼内容审查（"Green net check failed"）**
- 绿幕参考图 + prompt 含"胸前""双手"等词 → 触发文本审查
- 解法：用 `--chromakey blue`（脚本自动将绿幕参考图转成蓝幕），`prompt_extend=False`（关闭自动扩写避免引入敏感词），prompt 避开敏感描述

**2. 绿幕→蓝幕转换**
- `default.png` 是绿幕背景。用 `--chromakey blue` 时脚本自动调 `convert_chroma_color()` 将绿色背景转成蓝色，再 pad 蓝色两侧，保证整张图色幕统一
- chromakey 不在 ffmpeg 阶段做（会误删白衣服），完全交给 Python 后处理

**3. 清晰度优化**
- `compress_image` 长边上限 1280→1920（pad 后图更大，1280 会让角色只有 670px）
- 视频分辨率 720P→1080P（720P 生成的角色太模糊）
- pad 比例 0.75（不是 1.0，1.0 正方形浪费太多面积导致角色有效像素太少）
- `prompt_extend=False`（关闭百炼自动扩写，避免引入敏感词触发审查）

**4. 参考图 pad（防止角色动作超出画面）**
- 原始参考图 1482×2829（ratio 0.52，竖屏），角色一抬手就出画
- pad 到 0.75 比例（2121×2829），两侧填充色幕，角色有空间活动
- chromakey 时两侧色幕一并去掉

**5. 临时文件清理顺序**
- pad → compress → 读 base64 → 然后才删临时文件
- 先读进内存再清理，避免文件被提前删除导致 FileNotFoundError

**6. ⚠️ AI 视频背景漂移（最隐蔽的问题）**
- wan2.7-i2v 第一帧保留参考图的色幕背景，但后续帧模型会**自由发挥**把背景换成其他场景（如夕阳、室内等）
- 症状：视频前几帧蓝色背景正常，第 20 帧后背景变成暖色橙红 → chromakey 去不掉 → GIF 背景残留
- 根因：prompt 里没有明确约束背景保持纯色，模型认为色幕"不合理"就帮你换了
- **解法**：脚本自动在 prompt 末尾追加背景约束词（蓝幕加"纯蓝色背景"，绿幕加"纯色单色背景"避开审查）
- 验证方法：提取视频第 1/25/49 帧，检查色幕颜色占比是否稳定（>70% 表示背景没漂移）

### Chromium `file://` 图片缓存（打包版 GIF 不更新）

打包版用 `file://` 协议加载 GIF。Chromium 按完整 URL 缓存图片，磁盘上文件被替换后 URL 没变就返回缓存的旧图。`src/renderer.js` 已内置 cache-busting：`preloadGif()` 加 `?v=N` 参数，`set-config` 时 `_gifVersion++`。

重新生成 GIF 后需要同时更新 `public/gifs/` 和 `dist/gifs/` 的旧文件，否则全新安装时 `seedPackagedDataDir` 拷贝旧版。

### chromakey 误删白色衣服（最棘手的抠图问题）

**症状**：GIF 背景透明了，但角色白色衣服上出现大面积透明孔洞。

**根因**：AI 视频中色幕背景的光照会溢出到角色身上，白色衣服被蓝色/绿色光线污染，变成偏蓝/偏白的浅色。ffmpeg chromakey 基于颜色匹配，无法区分"被光照污染的白色衣服"和"背景色"——similarity 调高去干净背景但误删白衣服，调低保留白衣服但背景残留。

**关键数据**（蓝幕 heart 动作测试）：
| similarity | 总透明 | 角色区域透明 | 说明 |
|-----------|--------|-----------|------|
| 0.30 | 85% | **62%** | 白衣服几乎全没了 |
| 0.20 | 69% | 22% | 背景残留多 |
| 0.15 | 69% | 22% | 同上 |

绿幕测试更严重——sim=0.12 时角色区域 99.8% 透明。

**当前方案**：ffmpeg 阶段不做 chromakey（只做 palettegen + paletteuse），背景去除完全交给 Python 后处理（已有色幕检测 + 去色晕逻辑）。Python 后处理的色幕检测阈值更精确，能区分纯色幕和被光照污染的衣服区域。

> ⚠️ 如果 Python 后处理仍有白衣服误删，可能需要改为基于参考图的 mask 方案：用第一帧（纯参考图）生成精确 mask，后续帧只处理 mask 外的背景区域。

### 管理界面 API（需 bridge 服务运行）

```bash
# 异步生成，返回 202 + taskId
curl -s -X POST http://localhost:19851/action-sets/default/generate-action \
  -H "Content-Type: application/json" \
  -d '{"name":"pout","prompt":"...","duration":5}'

# 查询任务状态
curl -s http://localhost:19851/generation-tasks/<taskId>
```

自动完成：生成 GIF → 更新 action-sets.json → 广播到 renderer。

## Walk 动作（walk_right / walk_left）

- `walk_right` 和 `walk_left` 是两个独立 GIF 文件，`walk_left` 是镜像
- Walk 动作有特殊逻辑（窗口移动 + GIF 切换 + 边缘检测 + 方向切换）
- GIF 生成后需要裁掉前几帧起立/预备动作（分析质心 Y 确定裁剪点）
- 生成镜像：`frames_left = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in frames]`

## 截图透明窗口

Cloe Desktop 是 Electron 透明 overlay 窗口，`screencapture -R` 无法截取。必须用 PyObjC：

```python
import Quartz
from Foundation import NSURL

windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionAll, Quartz.kCGNullWindowID)
for w in windows:
    owner = w.get('kCGWindowOwnerName', '')
    if 'Cloe' in owner or 'Electron' in owner:
        bounds = w.get('kCGWindowBounds', {})
        x, y, ww, h = bounds['X'], bounds['Y'], bounds['Width'], bounds['Height']
        # 用 kCGWindowListOptionOnScreenOnly 截取区域所有可见图层
        image = Quartz.CGWindowListCreateImage(
            Quartz.CGRectMake(x, y, ww, h),
            Quartz.kCGWindowListOptionOnScreenOnly,
            Quartz.kCGNullWindowID,
            Quartz.kCGWindowImageNominalResolution)
        if image:
            url = NSURL.fileURLWithPath_('/path/to/output.png')
            dest = Quartz.CGImageDestinationCreateWithURL(url, 'public.png', 1, None)
            Quartz.CGImageDestinationAddImage(dest, image, None)
            Quartz.CGImageDestinationFinalize(dest)
            break
```

> ⚠️ 必须用 `kCGWindowListOptionOnScreenOnly`，`kCGWindowListOptionIncludingWindow` 对透明窗口=空白。

## Chat 消息注入

通过 `/chat/message` 向聊天窗口注入消息（文本 + 图片），注入的消息显示在聊天框中。

```bash
# 图片太大（~6MB base64）无法用命令行参数传，用 python 构造 JSON 文件再 curl -d @file
base64 -i /path/to/photo.png > /tmp/img_b64.txt
python3 -c "
import json
with open('/tmp/img_b64.txt','r') as f: b64=f.read().strip()
json.dump({'role':'assistant','content':'描述文字','image':b64}, open('/tmp/inject.json','w'))
"
curl -s -X POST http://localhost:19851/chat/message \
  -H 'Content-Type: application/json' \
  -d @/tmp/inject.json
# 返回 {"ok":true}
```

- 图片点击后用 `window.open` 弹出系统新窗口（黑底居中），直接看图
- **不要用自定义模态框**——不要实现 `previewImage` state、`chat-image-modal` overlay 等，之前试过被否决

## 注意事项

- 动作间隔至少 3-5 秒，太快会被打断
- `clients=0` 时动作不生效
- `action-sets.json` 和 `plugin-rules.json` 支持热加载（rules 有 5 秒 TTL 缓存）
- `plugin.yaml` 的 hooks 不支持热加载，修改后必须重启 Hermes 进程
