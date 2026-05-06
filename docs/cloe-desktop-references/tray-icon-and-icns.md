# Tray Icon Fix & icns Icon Replacement (2026-05-01)

## Tray Icon — Base64 Inline Solution

**Problem**: After packaging, file paths inside asar fail to read, `nativeImage.createFromPath()` returns an empty icon, tray doesn't display.

**Final solution**: Base64-encode a 32x32 PNG icon and hardcode it into the `createTray()` function in `launcher.js`.

```js
const TRAY_ICON_B64 = '...'; // base64 of 32x32 PNG
let trayIcon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_B64, 'base64'));
trayIcon = trayIcon.resize({ width: 22, height: 22 });
// ⚠️ Do NOT call trayIcon.setTemplateImage(true)!
// macOS turns template images into black-and-white semi-transparent, colored icons disappear on light menu bars
tray = new Tray(trayIcon);
```

**Generate base64**:
```bash
python3 -c "
from PIL import Image; import base64, io
img = Image.open('icon.png').resize((32,32), Image.LANCZOS)
buf = io.BytesIO()
img.save(buf, 'PNG')
print(base64.b64encode(buf.getvalue()).decode())
"
```

**Pitfalls encountered**:
- `nativeImage.createFromPath()` may return empty image after asar packaging
- `setTemplateImage(true)` turns the icon into black-and-white semi-transparent; colored icons completely disappear on light menu bars
- Icons that are too small (16x16) are not clear enough on the menu bar; recommend 32x32 resized to 22x22

## icns Icon Replacement Flow

Generate macOS icns from 1024x1024 PNG:

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

**Note**: package.json `"icon": "build/icon.icns"` points to this file.

## Generating Icons with Cursor + Gemini 3.1 Pro

When PIL native drawing is too rough, let Cursor's Gemini model generate:

```bash
cursor agent -p 'Use Python + PIL to generate a macOS app icon...' --model gemini-3.1-pro --yolo --workspace /tmp
```

**Available models**: `gemini-3.1-pro` (strong image generation capability), `gemini-3-flash` (faster but slightly lower quality)
View all: `cursor agent --list-models` (will hang, use timeout 8 to limit)
