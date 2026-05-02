# Tray Icon 修复 & icns 图标替换（2026-05-01）

## Tray Icon — base64 内嵌方案

**问题**：打包后 asar 内文件路径读取失败，`nativeImage.createFromPath()` 返回空图标，托盘不显示。

**最终方案**：将 32x32 PNG 图标 base64 编码硬编码到 `launcher.js` 的 `createTray()` 函数中。

```js
const TRAY_ICON_B64 = '...'; // base64 of 32x32 PNG
let trayIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'));
trayIcon = trayIcon.resize({ width: 22, height: 22 });
// ⚠️ 不要调用 trayIcon.setTemplateImage(true)！
// macOS 会把 template image 变成黑白半透明，浅色菜单栏上彩色图标会消失
tray = new Tray(trayIcon);
```

**生成 base64**：
```bash
python3 -c "
from PIL import Image; import base64, io
img = Image.open('icon.png').resize((32,32), Image.LANCZOS)
buf = io.BytesIO()
img.save(buf, 'PNG')
print(base64.b64encode(buf.getvalue()).decode())
"
```

**踩坑**：
- `nativeImage.createFromPath()` 在 asar 打包后可能返回空图像
- `setTemplateImage(true)` 会把图标变黑白半透明，彩色图标在浅色菜单栏上完全消失
- 图标太小（16x16）在菜单栏上不够清晰，建议 32x32 resize 到 22x22

## icns 图标替换流程

从 1024x1024 PNG 生成 macOS icns：

```bash
mkdir -p build/Cloe.iconset
for s in 16 32 128 256 512; do
  magick icon_1024.png -resize ${s}x${s} build/Cloe.iconset/icon_${s}x${s}.png
  magick icon_1024.png -resize $((s*2))x$((s*2)) build/Cloe.iconset/icon_${s}x${s}@2x.png
done
magick icon_1024.png -resize 1024x1024 build/Cloe.iconset/icon_512x512@2x.png
iconutil -c icns build/Cloe.iconset -o build/icon.icns
cp icon_1024.png build/icon_1024.png
```

**注意**：package.json `"icon": "build/icon.icns"` 指向此文件。

## 用 Cursor + Gemini 3.1 Pro 生成图标

PIL 原生绘图太粗糙时，让 Cursor 的 Gemini 模型生成：

```bash
cursor agent -p '用 Python + PIL 生成一个 macOS 应用图标...' --model gemini-3.1-pro --yolo --workspace /tmp
```

**可用模型**：`gemini-3.1-pro`（图像生成能力强）、`gemini-3-flash`（更快但质量略低）
查看全部：`cursor agent --list-models`（会 hang，用 timeout 8 限制）
