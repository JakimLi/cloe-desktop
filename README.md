# Cloe Desktop

Cloe 桌面小组件 — 基于 VRM 模型的桌面角色伴侣，与 Hermes 打通。

## 技术栈

- **Electron** — 透明悬浮窗，always on top
- **Three.js** — 3D渲染
- **@pixiv/three-vrm** — VRM模型加载与动画
- **Vite** — 前端构建

## 功能（MVP）

- ✅ 透明无边框悬浮窗，可拖拽
- ✅ 加载VRM模型（待机呼吸、随机眨眼、头部微动）
- ✅ 表情系统（开心/生气/悲伤/惊讶/放松）
- ✅ 动作（点头/摇头/挥手）
- ✅ WebSocket 接收 Hermes 事件触发动作
- ✅ 双击打开 DevTools（开发模式）

## 启动

```bash
# 安装依赖
npm install

# 开发模式（vite + electron）
npm run dev

# 生产构建
npm run build
npm start
```

## WebSocket API

连接 `ws://localhost:19850`，发送 JSON 消息：

```json
{ "action": "expression", "expression": "happy" }
{ "action": "nod" }
{ "action": "shake_head" }
{ "action": "wave" }
{ "action": "speak", "duration": 5 }
{ "action": "approve" }
{ "action": "tease" }
{ "action": "think" }
```

## 后续计划

- [ ] 用 VRoid Studio 制作 Cloe 专属模型
- [ ] 更多动作（拍桌子、捂嘴笑、歪头）
- [ ] TTS 语音集成（说话时嘴巴动）
- [ ] 右键菜单（切换模型、设置）
- [ ] 打字时自动看向屏幕（eye tracking）
- [ ] 系统托盘图标 + 菜单
