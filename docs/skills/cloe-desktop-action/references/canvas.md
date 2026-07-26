# Excalidraw 画布绘制

通过 HTTP API 在 Cloe Desktop 内嵌的 Excalidraw 画布上实时绘图。

## 前置条件

```bash
# 切换到 Canvas 模式
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"canvas"}'

# 隐藏 overlay（回到角色模式）
curl -s -X POST http://localhost:19851/canvas/hide

# 切到 Terminal 模式
curl -s -X POST http://localhost:19851/canvas/show -H 'Content-Type: application/json' -d '{"mode":"terminal"}'
```

## 深色背景配色建议

画布背景为**完全透明**，深色文字几乎不可见。

- **文字颜色**：`#ffffff`（白色）或浅色（`#dfe6e9`、`#b2bec3`）
- **容器/线条**：饱和色系（`#a29bfe` 紫、`#55efc4` 绿、`#fd79a8` 粉、`#74b9ff` 蓝、`#ffeaa7` 黄），`backgroundColor` 加 `33` 或 `44` 后缀做半透明

```json
{ "strokeColor": "#a29bfe", "backgroundColor": "#a29bfe44" }
```

## 绘制元素

```bash
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw \
  -H 'Content-Type: application/json' -d '{
  "elements": [
    { "id": "box1", "type": "rectangle", "x": 200, "y": 80,
      "width": 240, "height": 80,
      "strokeColor": "#ff6b6b", "backgroundColor": "#ff6b6b33",
      "roundness": { "type": 3 } },
    { "id": "text1", "type": "text", "x": 230, "y": 107,
      "text": "Hello", "fontSize": 22, "strokeColor": "#ff6b6b",
      "boundElements": [{ "id": "box1", "type": "rectangle" }] },
    { "id": "arrow1", "type": "arrow", "x": 320, "y": 160,
      "width": 0, "height": 80, "points": [[0,0],[0,80]],
      "strokeColor": "#a8e6cf", "strokeWidth": 2 }
  ]
}'
# 返回 {"ok":true,"count":3}
```

只需传最简 Skeleton JSON，CanvasMode 自动补全所有必需字段并正确计算文字尺寸。绘制后自动 `scrollToContent({ fitToContent: true })`。

## 文字尺寸 & 容器自动适配

1. **禁止手动设 text 的 `width`/`height`**——由 Excalidraw 自动计算
2. **容器自动撑大**：text 元素加 `boundElements` 关联容器后，容器自动扩展到 `文字宽高 + 48px padding`，文字自动居中：
   ```json
   { "id": "text1", "type": "text", "text": "任意长度文字",
     "boundElements": [{ "id": "box1", "type": "rectangle" }] }
   ```
   - 容器写最小宽高即可，不够会自动扩展
   - 支持 rectangle、ellipse、diamond 三种容器
   - 容器位置由 `x`/`y` 决定，文字自动居中到容器内

## 读取 / 清除场景

```bash
# 读取当前场景所有元素
curl -s http://localhost:19851/canvas/excalidraw/scene

# 清除画布
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/scene
```

## 视图引导（缩放 / 平移 / 聚焦 / 选中）

除了 draw/scene，还有一组引导式端点用来控制画布视图（不改变元素，只改变镜头）：

```bash
# 缩放到指定级别（1=100%）
curl -s -X POST http://localhost:19851/canvas/excalidraw/zoom -H 'Content-Type: application/json' \
  -d '{"zoom":1.5}'

# 平移到指定坐标（画布中心移到 x,y）
curl -s -X POST http://localhost:19851/canvas/excalidraw/pan -H 'Content-Type: application/json' \
  -d '{"x":200,"y":150}'

# 选中指定元素（传元素 id 数组）
curl -s -X POST http://localhost:19851/canvas/excalidraw/select -H 'Content-Type: application/json' \
  -d '{"ids":["box1","arrow1"]}'

# 清除选中
curl -s -X POST http://localhost:19851/canvas/excalidraw/deselect

# 聚焦指定元素（自动缩放+平移让这些元素填满视口）
curl -s -X POST http://localhost:19851/canvas/excalidraw/focus -H 'Content-Type: application/json' \
  -d '{"ids":["box1","text1"]}'

# 删除指定元素（按 id，不传 ids 则清空全部）
curl -s -X DELETE http://localhost:19851/canvas/excalidraw/elements -H 'Content-Type: application/json' \
  -d '{"ids":["box1"]}'
```

这些端点适合在"一边说一边画"的讲解流程里引导用户注意力：画完后 `focus` 到刚画的元素，配合 TTS 解说。

## ⚠️ 大 payload 必须用 @file

curl 内联 JSON payload 超过 ~2000 字符时会被 shell 截断，请求静默失败（返回空字符串）。

**必须先 write_file 再 curl -d @file：**

```python
from hermes_tools import write_file, terminal
write_file("/tmp/canvas-payload.json", json.dumps({"elements": elements}))
result = terminal("curl -s -X POST http://localhost:19851/canvas/excalidraw/draw -H 'Content-Type: application/json' -d @/tmp/canvas-payload.json")
# 务必检查返回值
data = json.loads(result["output"])
assert data.get("ok"), f"画图失败: {data}"
```

## 一边说一边画

```bash
# 先画
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw -H 'Content-Type: application/json' -d '{"elements": [...]}'

# 再说
python3 ~/.hermes/skills/creative/cloe-desktop-action/scripts/generate_tts.py \
  --text "解说内容" --speak
```

TTS 生成约 3 秒，可以先发 TTS 再画下一批。MOSI speak 播放期间其他 action 被 drop，但 draw 端点不受影响。

## 视觉层级

层级从底到顶：

1. `body` — `background: transparent`（Electron transparent 窗口）
2. `#gif-container` — 角色 GIF（canvas 模式下 `pointer-events: none`）
3. `#react-root` — z-index 5，React 覆盖层（黑色半透明背景）
4. Excalidraw 画布 — 透明（只有绘制的图形可见）

> ⚠️ curl payload 含 emoji 或换行符时，shell 会截断命令。用 `execute_code` 调 terminal 避免转义问题。

## 图片元素

画布支持显示图片。流程：先注册文件数据，再绘制 image 元素。

### 1. 注册文件

```bash
curl -s -X POST http://localhost:19851/canvas/excalidraw/files \
  -H 'Content-Type: application/json' -d '{
  "files": {
    "photo-1": {
      "mimeType": "image/jpeg",
      "data": "<base64 编码的图片数据>"
    }
  }
}'
# 返回 {"ok":true}
```

### 2. 绘制图片元素

```bash
curl -s -X POST http://localhost:19851/canvas/excalidraw/draw \
  -H 'Content-Type: application/json' -d '{
  "elements": [
    {
      "id": "img-1",
      "type": "image",
      "x": 100,
      "y": 100,
      "width": 200,
      "height": 200,
      "fileId": "photo-1",
      "status": "saved",
      "strokeColor": "transparent",
      "backgroundColor": "transparent",
      "roundness": null
    }
  ]
}'
```

### Python 示例（图片文件 → 画布）

```python
import base64, json
from hermes_tools import write_file, terminal

# 读取并编码图片
with open("/tmp/photo.jpg", "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

file_id = "my-photo-1"

# 注册文件
files_payload = {"files": {file_id: {"mimeType": "image/jpeg", "data": img_b64}}}
write_file("/tmp/canvas-files.json", json.dumps(files_payload))
r = terminal(f"curl -s -X POST http://localhost:19851/canvas/excalidraw/files -H 'Content-Type: application/json' -d @/tmp/canvas-files.json")

# 绘制图片元素（尺寸需要提前知道或给个默认值）
img_elements = [{
    "id": "img-1", "type": "image",
    "x": 100, "y": 100, "width": 300, "height": 200,
    "fileId": file_id, "status": "saved",
    "strokeColor": "transparent", "backgroundColor": "transparent"
}]
draw_payload = {"elements": img_elements}
write_file("/tmp/canvas-draw.json", json.dumps(draw_payload))
terminal(f"curl -s -X POST http://localhost:19851/canvas/excalidraw/draw -H 'Content-Type: application/json' -d @/tmp/canvas-draw.json")
```

> **注意**：图片尺寸不会自动适配，需要手动指定 width/height。

## 聊天消息注入

通过 HTTP API 向 Chat 面板（主窗口或独立聊天窗口）注入消息，支持纯文本和带图片的消息。

```bash
# 纯文本消息
curl -s -X POST http://localhost:19851/chat/message \
  -H 'Content-Type: application/json' -d '{
  "role": "assistant",
  "content": "Hello from Hermes!"
}'

# 带图片的消息
curl -s -X POST http://localhost:19851/chat/message \
  -H 'Content-Type: application/json' -d '{
  "role": "assistant",
  "content": "看看这张图",
  "image": "<base64 编码的图片>"
}'
```

消息会同时发送到主窗口的 ChatPanel 和独立的聊天窗口（如果打开的话）。图片支持点击放大查看。
