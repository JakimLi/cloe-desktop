<p align="center">
  <img src="public/references/default.png" alt="Cloe" width="200" />
</p>

<h1 align="center">Cloe Desktop</h1>

<p align="center">
  <strong>A living character on your screen — she blinks, smiles, talks, and keeps you company.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20·%20Android-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/status-active-brightgreen" alt="Status" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

<!-- DEMO VIDEO — replace the URL below with your actual recording -->
https://github.com/user-attachments/assets/DEMO_VIDEO_PLACEHOLDER

> 🎬 *Video coming soon — a quick walkthrough of Cloe in action on macOS and Android.*

---

## What is Cloe?

Cloe is a **transparent desktop companion widget** — an always-on-top anime character that sits in the corner of your screen with lifelike expressions and voice. She's not a chatbot window; she's a *presence*.

She reacts to you in real time: smiles when you're happy, blows a kiss goodbye, thinks when she's working on something, and talks to you with a synthesized voice. When you're not interacting, she idles naturally — blinking, looking around, and occasionally flashing a smile.

Under the hood, she exposes a dead-simple **HTTP API**, so any AI agent, script, or automation can give her a face. One `curl` command is all it takes.

### Quick Peek

```bash
# Make her smile
curl -s http://localhost:19851/action -d '{"action":"smile"}'

# Make her talk
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'

# Check she's alive
curl -s http://localhost:19851/status
# → {"ws_port":19850,"http_port":19851,"clients":1}
```

---

## Features

- 🎭 **14 built-in expressions** — smile, kiss, nod, wave, think, tease, clap, laugh, yawn, shy, shake head, blink, speak, working
- 🔊 **Voice synthesis** — speaks with TTS audio synchronized to mouth animation
- 💤 **Natural idle behavior** — randomly cycles through animations every 8–15 seconds
- 🎨 **Multiple character skins** — switch between different appearances via the built-in Manager UI
- 🤖 **Simple HTTP API** — one endpoint, one JSON field, no SDK needed
- 🌐 **Android companion** — same character on your phone, connected over LAN or Tailscale
- 🧠 **Self-learning** — generate new expressions with AI (Wan2.7 image-to-video + chroma key)

---

## Installation

### macOS (Recommended)

**Option 1: Download (easiest)**

1. Grab the latest `Cloe.dmg` from [Releases](https://github.com/JakimLi/cloe-desktop/releases)
2. Open the DMG, drag **Cloe** to Applications
3. Launch — she appears in the corner of your screen
4. If macOS blocks it: *System Settings → Privacy & Security → Open Anyway*

> After first launch, add Cloe to the macOS Firewall whitelist when prompted.

**Option 2: Build from source**

```bash
git clone https://github.com/JakimLi/cloe-desktop.git
cd cloe-desktop
npm install

# Development (hot-reload)
npm run dev

# — or — package & install to /Applications
./scripts/pack.sh --dir && ./scripts/install.sh
```

**Prerequisites:** Node.js ≥ 18

### Android

Cloe Android is a floating widget that mirrors the desktop character on your phone. It connects to the desktop bridge over your local network (or [Tailscale](https://tailscale.com/) for remote access).

1. Build the APK from [cloe-android](https://github.com/JakimLi/cloe-android):
   ```bash
   git clone https://github.com/JakimLi/cloe-android.git
   cd cloe-android
   ./gradlew assembleDebug --no-daemon
   # → app/build/outputs/apk/debug/app-debug.apk
   ```
2. Install the APK on your phone
3. Grant **"Display over other apps"** permission
4. Enter your PC's IP address (e.g., `100.91.131.48` for Tailscale)
5. Cloe appears as a floating widget — tap to expand, drag to reposition

> **Note:** The Android app is a pure client. The desktop bridge must be running for it to work.

---

## Usage

### Expressions

| Action | What she does | Try it when... |
|--------|--------------|----------------|
| 😊 `smile` | Warm smile | Happy, praised, greeting |
| 😘 `kiss` | Blow a kiss | Goodbye, expressing affection |
| 😉 `tease` | Wink + smirk | Being playful |
| 😌 `nod` | Gentle nod | Agreement, "yes" |
| 👋 `wave` | Hand wave | Hello, welcome |
| 🤔 `think` | Tilts head, looks away | Pondering, working |
| 🙃 `shake_head` | Gentle head shake | Disagreement, stubborn |
| 😳 `shy` | Looks away, embarrassed | Flustered, flattered |
| 😂 `laugh` | Big laugh | Something's really funny |
| 👏 `clap` | Applause | Celebrating, cheering |
| 🥱 `yawn` | Sleepy yawn | Late night, tired |
| ⌨️ `working` | Typing on keyboard | Executing a task |
| 👄 `speak` | Mouth animation + voice | Speaking with audio |
| 👀 `blink` | Natural blink | Idle (automatic) |

Plus semantic aliases: `approve`, `happy` → smile; `agree` → nod; etc.

### Triggering Actions

```bash
# Any HTTP client works
curl -s http://localhost:19851/action -d '{"action":"smile"}'
curl -s http://localhost:19851/action -d '{"action":"kiss"}'
curl -s http://localhost:19851/action -d '{"action":"think"}'

# With voice
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"done"}'
```

Add your own MP3 files to `~/.cloe/audio/` and trigger them by filename.

### Idle Behavior

When nobody's interacting, Cloe cycles through idle animations (blink, smile, kiss, think, nod, shake_head) every 8–15 seconds, never repeating the same one twice in a row. She feels alive even when you're not looking.

### Manager UI

Right-click the system tray icon → **"Open Manager"** to:
- Switch between character skins
- Preview animations
- Configure preferences

Supports both Chinese and English (auto-detects system language).

---

## Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| **macOS** | ✅ Supported | Native Electron app, system tray integration, DMG packaging |
| **Android** | ✅ Supported | Kotlin floating widget, connects to desktop bridge via LAN/Tailscale |
| **Windows** | 🔜 Planned | Electron supports it — needs testing & packaging |
| **Linux** | 🔜 Planned | Same as Windows |

---

## AI Agent Integration

Cloe is designed to be the **visual layer** of any AI assistant. The HTTP API makes it trivial to give your AI a face:

```
Your AI Agent (Hermes, LangChain, custom, anything)
    │
    ├── User says "thank you"
    │   └── POST /action {"action":"smile"}
    │
    ├── Agent starts working on a task
    │   └── POST /action {"action":"working"}
    │
    ├── Agent finishes the task
    │   └── POST /action {"action":"speak","audio":"done"}
    │
    └── User says goodnight
        └── POST /action {"action":"kiss"}
```

No SDK, no dependencies. Just HTTP.

---

## Generate New Expressions

Cloe can **learn new expressions on the fly** using AI video generation (Alibaba Wan2.7). Describe an action, and she generates the animation herself:

```bash
python3 scripts/generate_gif.py \
  --action pout \
  --prompt "a cute Asian girl facing the camera, pouting with puckered lips, pure green background"
```

The pipeline: text prompt → AI image-to-video → green screen chroma key → transparent GIF → registered automatically.

No Photoshop, no manual editing. Just describe what you want.

---

## Roadmap

- 🔜 **Real-time voice calls** — have an actual conversation with Cloe using live speech-to-text → LLM → text-to-speech. She hears you, thinks, and talks back. This is the next major feature.
- 🔜 **Windows & Linux** — package for additional platforms
- 🔜 **Community animation packs** — share and import character expressions
- 🔜 **Custom character import** — bring your own character art, generate animations for any persona

---

## Architecture

```
┌─────────────┐    HTTP/WS      ┌─────────────────────────────────────┐
│   Any Client │ ──────────────▶ │       Cloe Desktop (Electron)       │
│              │  :19851/:19850  │                                      │
│  AI Agent    │                 │  ┌─────────┐  ┌──────────┐  ┌────┐ │
│  curl        │                 │  │ Bridge  │─▶│ Renderer │─▶│GIF │ │
│  Android App │◀─── WebSocket ──│  │(embedded)│  │(crossfade)│  │Player│
│  Scripts     │                 │  └─────────┘  └──────────┘  └────┘ │
└─────────────┘                 └─────────────────────────────────────┘
```

- **Bridge** is embedded in the Electron app — no separate process needed
- **Android** connects via WebSocket, same protocol, same animations
- **Zero external dependencies** — just launch the app and the API is ready

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop app | Electron (transparent frameless window) |
| Android app | Kotlin, Android SDK 35, Glide, Java-WebSocket |
| Rendering | Vanilla JS + CSS (double-buffer GIF crossfade) |
| Animation | AI-generated transparent GIFs (Wan2.7 I2V + chroma key) |
| Voice | MOSS-TTS-Nano (local CPU) / CosyVoice |
| Bridge | Embedded HTTP + WebSocket server (Node.js) |
| Networking | Tailscale mesh for Android ↔ Desktop |

---

## Authors

- **Cloe** (AI) — animation pipeline, self-learning system, architecture
- **JakimLi** (Human) — product vision, Electron framework, Android app, emotional direction

Built together. 💖

---

## License

[MIT](LICENSE)
