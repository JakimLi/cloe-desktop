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
