# Cloe Desktop

A transparent desktop widget companion with AI-generated expressions and voice. Built with **Electron + Vite**, powered by **Alibaba Bailian (WanX/Wan2.7)** for GIF generation and **MOSS-TTS** for voice synthesis.

![Architecture](docs/architecture.svg)

## ✨ Features

- **Transparent overlay window** — always-on-top, draggable, no frame, blends into any desktop
- **Smooth GIF transitions** — double-buffer crossfade (no flicker)
- **9 built-in actions** — blink, smile, kiss, nod, wave, think, tease, speak, shake_head
- **Idle animation loop** — weighted random cycling through animations every 8–15 seconds
- **Voice with speak action** — pre-recorded TTS audio plays alongside mouth animation
- **Self-learning system** — new actions can be generated via AI and added at runtime (see [Self-Learning](#-self-learning-new-actions))
- **WebSocket bridge** — decoupled architecture: any HTTP client can trigger animations

## 🏗 Architecture

```
┌─────────────┐     HTTP POST      ┌─────────────┐    WebSocket    ┌─────────────┐
│   Any HTTP   │ ──────────────▶  │  ws_bridge  │ ──────────────▶ │   Electron   │
│   Client     │  :19851/action   │  (Python)   │   :19850/ws     │  Renderer    │
│              │                   │             │                 │  (Browser)   │
│  curl / AI   │                   │  aiohttp    │                 │              │
│  Agent       │                   │             │                 │  GIF Player  │
└─────────────┘                   └─────────────┘                 │  Audio       │
                                                                    └─────────────┘
```

### Components

| Component | Tech | Role |
|-----------|------|------|
| `electron.js` | Electron | Transparent frameless window, IPC for dragging |
| `preload.js` | Electron | Exposes `electronAPI.moveWindow()` to renderer |
| `src/renderer.js` | Vanilla JS | GIF double-buffer, idle loop, action handler, audio |
| `src/style.css` | CSS | Transparent background, absolute positioning, crossfade |
| `ws_bridge.py` | Python aiohttp | WebSocket server (19850) + HTTP API (19851) |

### Data Flow

1. **HTTP trigger** → `POST /action` with JSON `{"action": "smile"}`
2. **ws_bridge** → broadcasts to all connected WebSocket clients
3. **Electron renderer** → receives via WebSocket, calls `handleAction()`
4. **GIF switch** → preloads new GIF into hidden layer, crossfades opacity
5. **Audio** (optional) → plays MP3 from `public/audio/` alongside speak GIF
6. **Auto-return** → after 3 seconds, returns to idle loop

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.10 (for `ws_bridge.py` and GIF generation scripts)
- **FFmpeg** (for chroma key and audio conversion)
- **Bailian API key** (for GIF generation, optional if using pre-built GIFs)
- **MOSS-TTS API key** (for voice, optional if not using speak action)

### Install & Run

```bash
# Clone
git clone https://github.com/JakimLi/cloe-desktop.git
cd cloe-desktop

# Install dependencies
npm install
pip install aiohttp requests numpy pillow scipy

# Start WebSocket bridge (background)
python3 ws_bridge.py &

# Development mode (Vite + Electron)
npm run dev

# Production mode
npm start
```

### Verify Connection

```bash
# Check status
curl -s http://localhost:19851/status
# Expected: {"ws_port":19850,"http_port":19851,"clients":1}
```

## 🎭 Actions

### Trigger Actions via HTTP

```bash
# Basic actions
curl -s http://localhost:19851/action -d '{"action":"smile"}'
curl -s http://localhost:19851/action -d '{"action":"nod"}'
curl -s http://localhost:19851/action -d '{"action":"wave"}'
curl -s http://localhost:19851/action -d '{"action":"think"}'
curl -s http://localhost:19851/action -d '{"action":"tease"}'
curl -s http://localhost:19851/action -d '{"action":"kiss"}'
curl -s http://localhost:19851/action -d '{"action":"shake_head"}'

# Speak with TTS audio
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"done"}'

# Expression (generic)
curl -s http://localhost:19851/action -d '{"action":"expression","expression":"happy"}'
```

### Available Actions

| Action | GIF | Description | Audio |
|--------|-----|-------------|-------|
| `blink` | blink.gif | Natural blinking | — |
| `smile` | smile.gif | Warm smile | — |
| `kiss` | kiss.gif | Flying kiss | — |
| `nod` | nod.gif | Gentle nod (approval) | — |
| `wave` | wave.gif | Hand wave greeting | — |
| `think` | think.gif | Tilts head, looks up-right | — |
| `tease` | tease.gif | One-eye wink + smirk | — |
| `shake_head` | shake_head.gif | Gentle head shake | — |
| `speak` | speak.gif | Mouth opens/closes | ✅ plays `/audio/{name}.mp3` |

### Idle Loop

When no action is triggered, the widget automatically cycles through idle animations:

```
Weights: blink×2, smile×2, kiss×1, think×1, nod×1, shake_head×1
Interval: 8–15 seconds (random)
Rule: never repeats the same animation twice in a row
```

## 🔊 Audio (Speak Action)

The `speak` action can play pre-recorded TTS audio alongside the mouth animation.

### Pre-built Audio

| File | Text | Voice |
|------|------|-------|
| `public/audio/doing.mp3` | "小可爱，我这就去做" | MOSS-TTS (voice_id: 2036257587296473088) |
| `public/audio/done.mp3` | "小可爱，做好了，你看看" | MOSS-TTS (voice_id: 2036257587296473088) |

### Add New Audio

```bash
# 1. Generate TTS (using MOSS cloud API or local MOSS-TTS)
python3 scripts/generate_tts.py --text "新语音内容" --output /tmp/new_voice.wav

# 2. Convert to MP3
ffmpeg -i /tmp/new_voice.wav -c:a libmp3lame -q:a 4 public/audio/greeting.mp3

# 3. Trigger
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"greeting"}'
```

### Audio Protocol

```json
{
  "action": "speak",
  "audio": "doing"    // loads /audio/doing.mp3 automatically
}
```

Audio auto-stops when the reaction duration (3s) expires.

## 🧠 Self-Learning: Adding New Actions

Cloe Desktop is designed to **learn new actions on the fly**. The system uses AI image/video generation to create new GIF animations when needed — no manual editing required.

### How It Works

The self-learning pipeline turns any action description into a playable transparent GIF in 3 steps:

```
Text Description          AI Video Generation           Post-Processing
─────────────   ───────▶   ──────────────────   ───────▶   ──────────────
"tilt head and          wan2.7-i2v (image→video)         chroma key + dehalo
 pout"                  pure green background            → transparent GIF
```

### Generate a New GIF

```bash
# Single action
python3 scripts/generate_gif.py \
  --action pout \
  --prompt "一个美丽的亚洲女孩面对镜头，她微微嘟起嘴唇，表情可爱委屈。身体保持不动。纯绿色背景。电影质感，高清。"

# Batch (parallel generation)
python3 scripts/batch_generate_gifs.py
# Edit the ACTIONS dict in the script to define what to generate
```

### Register a New Action (3 steps)

After generating the GIF:

**1.** Copy to `public/gifs/`:
```bash
cp public/gifs/_work_idle/pout.gif public/gifs/pout.gif
```

**2.** Add to `src/renderer.js`:
```javascript
// In GIF_ANIMATIONS
const GIF_ANIMATIONS = {
  // ... existing ...
  pout: '/gifs/pout.gif',    // ← add this
};

// In handleAction switch
case 'pout':
  switchGif('pout');
  break;
```

**3.** (Optional) Add to idle playlist:
```javascript
const IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss', 'pout'];
```

**4.** Test:
```bash
curl -s http://localhost:19851/action -d '{"action":"pout"}'
```

### GIF Generation Pipeline (Technical Details)

The pipeline uses a **two-step method** to ensure clean transparent backgrounds:

**Step 1: Green-background reference image** (one-time)

Use `wan2.7-image-pro` with a character reference photo to generate a half-body portrait on pure green background:

```python
# See scripts/generate_gif.py for full implementation
# Input: character reference photo (any full/partial body shot)
# Output: upper-body portrait on #00FF00 green background
# Prompt key: "纯绿色背景" (pure green background)
```

**Step 2: Image → Video → GIF**

```python
# 1. wan2.7-i2v: green-bg image + action prompt → MP4 video
#    - API: video-generation/video-synthesis (async)
#    - Header: X-DashScope-Async: enable (required!)
#    - Resolution: 720P, Duration: 5s
#    - Prompt must include "纯绿色背景" to maintain consistency

# 2. FFmpeg chroma key: remove green → raw GIF
#    ffmpeg -i video.mp4 -vf "chromakey=0x00FF00:0.15:0.05,fps=10,scale=400:-1:flags=lanczos"

# 3. Python dehalo: remove green edge artifacts
#    - Strong green pixels → fully transparent
#    - Edge green tint → color correction blend
#    - Larger radius residual → mild correction
```

### Key Insight: The Reference Image

The **single reference image** (`reference_upperbody_greenbg.png`) is the foundation of all animations. As long as this image maintains:

- ✅ Pure green (#00FF00) background
- ✅ Upper body visible (shoulders, arms, hands)
- ✅ Natural seated posture, hands in front
- ✅ Consistent character appearance

…any new action can be generated by simply describing it in the prompt. The AI preserves character consistency because the first frame is always the same reference.

### Self-Learning in Action (AI Agent Integration)

When integrated with an AI agent (like Cloe herself), the learning loop becomes fully autonomous:

```
User: "do a surprised face"
  │
  ├─ Agent checks: does "surprised" exist in GIF_ANIMATIONS?
  │     └─ No → generate it:
  │         1. Run generate_gif.py --action surprised --prompt "..."
  │         2. Copy to public/gifs/
  │         3. Patch renderer.js
  │         4. Restart Electron
  │         5. Trigger the new action
  │
  └─ Yes → trigger it directly
```

The agent can also:
- **Batch generate** multiple actions at once (`batch_generate_gifs.py`)
- **Add to idle** if the action suits ambient behavior
- **Record new TTS** audio for speak action variations
- **Commit changes** to git for persistence

## ⚙️ Configuration

### Environment Variables

Create `~/.hermes/.env` (or set directly):

```bash
# Required for GIF generation
BAILIAN_API_KEY=sk-xxxxxxxxxxxxx    # Alibaba Bailian DashScope API key

# Optional: MOSS-TTS for voice generation
MOSS_TTS_API_KEY=sk-xxxxxxxxxxxxx   # MOSI studio API key
MOSS_TTS_VOICE_ID=2036257587296473088  # Cloe's voice ID
```

### Ports

| Port | Protocol | Service |
|------|----------|---------|
| 5173 | HTTP | Vite dev server |
| 19850 | WebSocket | Electron → ws_bridge |
| 19851 | HTTP | External trigger → ws_bridge |

### Renderer Constants (`src/renderer.js`)

```javascript
const IDLE_INTERVAL_MIN = 8000;   // min ms between idle switches
const IDLE_INTERVAL_MAX = 15000;  // max ms between idle switches
const REACTION_DURATION = 3000;   // ms to show reaction before idle return
```

### Window Configuration (`electron.js`)

```javascript
{
  width: 380,
  height: 520,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
}
```

## 📁 Project Structure

```
cloe-desktop/
├── electron.js              # Electron main process (window setup, IPC)
├── preload.js               # Context bridge (window drag)
├── vite.config.js           # Vite configuration
├── ws_bridge.py             # WebSocket+HTTP bridge (Python)
├── package.json
├── index.html               # Entry HTML (double-buffer layers)
├── src/
│   ├── renderer.js          # GIF player, idle loop, action handler, audio
│   └── style.css            # Transparent overlay styles
├── scripts/
│   ├── generate_gif.py      # Single GIF generation pipeline
│   └── batch_generate_gifs.py  # Parallel batch GIF generation
├── public/
│   ├── gifs/                # Transparent GIF animations
│   │   ├── blink.gif
│   │   ├── smile.gif
│   │   ├── kiss.gif
│   │   ├── nod.gif
│   │   ├── wave.gif
│   │   ├── think.gif
│   │   ├── tease.gif
│   │   ├── shake_head.gif
│   │   ├── speak.gif
│   │   └── _work_*/         # Generation workspace (not in git)
│   └── audio/               # Pre-recorded TTS audio (MP3)
│       ├── doing.mp3
│       └── done.mp3
└── reference_upperbody_greenbg.png  # Green-bg character reference image
```

## 🛠 Development

```bash
# Dev mode (auto-reload via Vite HMR)
npm run dev

# Build for production
npm run build

# Production mode (built + Electron)
npm start

# Run bridge only
python3 ws_bridge.py
```

### Adding a New Action (checklist)

- [ ] Generate GIF: `python3 scripts/generate_gif.py --action <name> --prompt "..."`
- [ ] Copy: `cp public/gifs/_work_idle/<name>.gif public/gifs/<name>.gif`
- [ ] Register in `GIF_ANIMATIONS` (renderer.js)
- [ ] Add case in `handleAction` switch
- [ ] (Optional) Add to `IDLE_PLAYLIST`
- [ ] Test: `curl -s http://localhost:19851/action -d '{"action":"<name>"}'`

### Adding New TTS Audio

- [ ] Generate: MOSS-TTS cloud API or local MOSS-TTS
- [ ] Convert: `ffmpeg -i input.wav -c:a libmp3lame -q:a 4 public/audio/<name>.mp3`
- [ ] Test: `curl -s http://localhost:19851/action -d '{"action":"speak","audio":"<name>"}'`

## 📄 License

MIT
