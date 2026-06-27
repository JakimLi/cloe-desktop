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
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。"

# 蓝幕模式（对黑发效果更好）
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_gif_v2.py \
  --action pout \
  --prompt "...纯蓝色背景..." --chromakey blue

# 指定参考图
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_gif_v2.py \
  --action wave \
  --prompt "..." --reference ~/.cloe/references/default.png
```

脚本自动完成：压缩参考图 → 百炼 wan2.7-i2v 生成视频 → ffmpeg chromakey → 去色晕 → 透明 GIF → 复制到 `~/.cloe/gifs/`。

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
- **确保人物完整在画面内**：动作帧中角色会身体展开（抬手、叉腰、跳舞）。脚本已内置 `pad_reference_to_wider()` 自动把竖屏参考图（1482×2829）两侧填充色幕变成 1:1 正方形（2829×2829），角色动作有空间展开，最终 GIF 输出 400×400。prompt 中仍建议明确描述动作幅度
- **色幕一致性**：pad 填充的颜色与 `--chromakey` 参数一致。参考图绿幕 → `--chromakey green`，参考图蓝幕 → `--chromakey blue`。**不要混用**（绿幕参考图 + blue pad → ffmpeg 只去掉两侧蓝色，中间绿色残留）
- **不要在 prompt 里写"纯绿色背景"**：会触发 wan2.7-i2v 内容审查（`Green net check failed`）。脚本已自动 pad 色幕，prompt 只需描述动作即可
- **电影质感，高清**：提高生成质量
- 时长一般 3-5 秒

### 窗口尺寸与 GIF 裁切

GIF 尺寸为 400×400（新版 1:1 比例，`pad_reference_to_wider` 生成）。窗口 `BASE_WIDTH` 必须 ≥ 560（给 `characterPosition` 偏移和 `characterScale` 留余量），`BASE_HEIGHT` 保持 520。详细排查见 `cloe-desktop-dev` skill 的 pitfalls.md "GIF 边缘被裁切" 章节。

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
