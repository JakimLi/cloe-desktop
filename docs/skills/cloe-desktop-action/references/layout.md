# 角色布局控制（位置 + 大小）

控制角色在桌面窗口中的位置和缩放。这不是表情动作，而是角色的空间布局。

## API

### 获取布局

```bash
curl -s http://localhost:19851/character-layout
# 返回: {"position":{"x":0.5,"y":1},"size":{"scale":1}}
```

### 设置布局

```bash
# 同时设置位置和大小
curl -s -X POST http://localhost:19851/character-layout \
  -H 'Content-Type: application/json' \
  -d '{"position":{"x":0.5,"y":1},"size":{"scale":1.2}}'

# 只调整位置（往右挪）
curl -s -X POST http://localhost:19851/character-layout \
  -H 'Content-Type: application/json' \
  -d '{"position":{"x":0.7,"y":1}}'

# 只调整大小
curl -s -X POST http://localhost:19851/character-layout \
  -H 'Content-Type: application/json' \
  -d '{"size":{"scale":1.5}}'
```

## 参数说明

### position（位置）

- `x`: 水平位置，0 = 最左，0.5 = 居中，1 = 最右
- `y`: 垂直位置，0 = 最上，1 = 最下（默认底部）
- 通过 CSS translate 实现，不是 object-position

### size（缩放）

- `scale`: 缩放因子，范围 0.2 ~ 3.0，默认 1.0
- 通过 CSS transform scale 实现

## 实时同步

- 设置后主窗口即时响应（IPC 广播 `character-position-updated` / `character-size-updated`）
- 窗口 resize 时自动重新计算 translate 偏移
- 偏好设置界面的 D-pad 和滑块也走同一个 API

## 使用场景

- 可可自己挪位置："往右边来点" → POST position x+0.1
- 可可调整大小：配合特定场景放大/缩小自己
- 偏好设置手动调整：D-pad 方向键 + 缩放滑块

## 默认值

```json
{"position":{"x":0.5,"y":1},"size":{"scale":1}}
```

居中、底部、原始大小。

## 注意事项

- position 用的是 0~1 的比例值，不是像素，窗口大小变化不影响相对位置
- scale 有 0.2 ~ 3.0 的硬限制（launcher.js 端 clamp）
- POST 是合并更新：只传 position 不影响 size，反之亦然
