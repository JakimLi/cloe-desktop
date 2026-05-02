---
name: cloe-desktop-action
description: Dynamically discover and trigger Cloe Desktop character expression animations via HTTP API
---

# Cloe Desktop Action — Desktop Animation Trigger

## Architecture

```
Hermes / any HTTP client
  → Bridge HTTP API (:19851)
    → WebSocket (:19850)
      → Electron renderer
        → Double-buffered GIF crossfade
```

The Bridge is embedded in the Electron main process's `launcher.js`, with WS + HTTP running in the same process — no external dependencies.

## Prerequisites

Cloe Desktop must be running (either in dev mode or as Cloe.app):

```bash
curl -s http://localhost:19851/status
# Expected: {"ws_port":19850,"http_port":19851,"clients":1}
```

`clients=1` means the Electron renderer process is connected. When `clients=0`, triggering an action will not produce an error but will have no effect.

## Dynamically Discover Available Actions (Important)

**Do not hardcode the action list.** New actions can be generated at any time through the management UI and retrieved in real time via the API:

```bash
# Get all actions in the currently active action set
curl -s http://localhost:19851/actions

# Get all action sets (including name, action count, and whether active)
curl -s http://localhost:19851/action-sets

# Get details of a specific action set
curl -s http://localhost:19851/action-sets/default

# Get the action list for a specific action set
curl -s http://localhost:19851/actions?set=default
```

### API Response Format

`GET /actions` returns:

```json
{
  "activeSetId": "default",
  "actions": [
    {
      "name": "smile",
      "gifFile": "smile.gif",
      "gifPath": "gifs/smile.gif",
      "trigger": "idle",
      "idleWeight": 2,
      "hookNames": ["smile", "approve", "happy"],
      "special": null,
      "description": "微笑，用于开心、赞同、被夸的时候",
      "descriptionEn": "Smile — happiness, agreement, being praised"
    }
  ]
}
```

**Field meanings:**

| Field | Description |
|-------|-------------|
| `name` | Unique action identifier, used for triggering |
| `description` | Chinese semantic description — the meaning and applicable scenarios of the action, used for selecting actions |
| `descriptionEn` | English semantic description |
| `trigger` | Trigger mode: `idle` (auto-rotation) / `hook` (manual trigger) / `manual` (system internal, e.g. working) |
| `idleWeight` | Weight in the idle rotation (0 means excluded from idle) |
| `hookNames` | **List of available trigger names** — any of these can be passed as the action parameter |
| `special` | Special function marker: `"语音"` indicates TTS support, `"工作模式"` indicates system locked state |

### How to Choose an Action

1. **Query the API** `GET /actions` to get the action list and descriptions
2. **Match context based on `description`** — each action has a semantic description explaining its meaning and applicable scenarios
3. Use `name` or any value from `hookNames` as the trigger parameter
4. `hookNames` are alias extensions: for example, smile's hookNames are `["smile", "approve", "happy"]` — passing any one of them will trigger the smile animation

## Triggering an Action

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

Use any `name` or value from `hookNames` discovered in the previous step as `<ACTION_NAME>`.

**Behavior:** The action plays for approximately 3 seconds then automatically returns to the idle loop. In working mode, after a reaction finishes playing, it returns to the working animation.

## Voice Actions (speak)

Actions marked with `special: "语音"` support three voice playback modes.

### Mode 1: Pre-recorded Voice (`audio` field)

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
```

Pre-recorded files are stored in the `public/audio/` directory. To add a new voice:
1. Generate a WAV using TTS
2. `ffmpeg -i input.wav -c:a libmp3lame -q:a 4 public/audio/xxx.mp3`
3. Trigger: `{"action":"speak","audio":"xxx"}`

### Mode 2: Dynamic Audio URL (`audio_url` field)

Pass an audio URL (data URL or HTTP URL), and the desktop character will play the voice while speaking:

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:18999/cloe_tts.wav"}'
```

- Supported formats: `data:audio/wav;base64,...`, `data:audio/mp3;base64,...`, `http(s)://...`
- **Data URL limitation:** The curl command-line argument limit is approximately 128KB; audio exceeding about 5 seconds will exceed this limit when base64-encoded. Use an HTTP URL for longer audio.
- **Playback duration:** In `audio_url` mode, the animation waits for the audio to finish playing before returning to idle (not subject to the 3-second reaction limit). The `audio` pre-recorded mode still uses a fixed 3-second timer.
- Priority: `audio_url` > `audio`

### Mode 3: Local Streaming TTS (`text` field)

Requires a local TTS server running (port 19853). The renderer connects directly to the TTS WebSocket to receive and play the PCM stream:

```bash
# Prerequisite: start the TTS server
cd ~/work/MOSS-TTS-Nano && source venv/bin/activate && python tts_server.py --port 19852

# Trigger
curl -s http://localhost:19851/action -d '{"action":"speak","text":"你好呀，小可爱！"}'
```

On Intel Macs, the generation ratio is approximately 10:1 (1 second of audio requires about 10 seconds to generate). The current strategy is to buffer completely before playing. This can be changed to streaming playback once M1 chips are available.

**TTS text formatting:** Use complete, coherent sentences. Avoid excessive ellipses/tildes/exclamation marks. Punctuation is treated as pauses, which can cause choppy playback.

## System Actions

Some actions are automatically triggered by the system and do not need to be called manually:

| Action | Trigger Method | Description |
|--------|---------------|-------------|
| `working` | Gateway hook `agent:start` | Typing keyboard GIF, locks working mode |
| `idle` | Gateway hook `agent:end` | Returns to idle random rotation |
| `wave` | Gateway hook `session:start` | Greets at new session start |
| `kiss` | Gateway hook `session:end` | Session end |

### Idle Standby Loop

When no action is triggered, Electron automatically plays actions with `trigger: "idle"` in a weighted random sequence. It switches every 8–15 seconds without repeating consecutively. Frequency can be controlled via `idleWeight`.

## Usage Examples

```bash
# First, check available actions
curl -s http://localhost:19851/actions

# Happy → choose from hookNames
curl -s http://localhost:19851/action -d '{"action":"happy"}'

# Thinking
curl -s http://localhost:19851/action -d '{"action":"think"}'

# Speaking + TTS
curl -s http://localhost:19851/action -d '{"action":"speak","text":"想你了"}'
```

## Multiple Action Sets

Multiple character appearances are supported (e.g., default, school uniform, casual wear, etc.), switchable via the management UI. After switching, `GET /actions` returns the content of the new action set — **no code changes required**.

- `GET /action-sets` — list all action sets
- `GET /action-sets/:id` — view details of a specific set
- After switching, the desktop automatically uses the new GIFs, and the API automatically returns the new action list

## Hermes Plugin (Auto-trigger)

`~/.hermes/plugins/cloe-desktop/` is a Hermes lifecycle plugin that listens for tool calls, LLM calls, session start/end, and other events, automatically triggering the corresponding expression animations.

### Plugin Structure

```
~/.hermes/plugins/cloe-desktop/
├── __init__.py      # Register hooks
├── handler.py       # Core logic: throttling, rule matching, HTTP triggering
└── plugin.yaml      # Plugin metadata + registered hooks
```

### Trigger Rule Configuration

Rules are **not hardcoded** — they are stored in `<dataDir>/plugin-rules.json` (default: `~/.cloe/plugin-rules.json`), with a 5-second cache that auto-refreshes. The Manager UI can read and write this file directly for configuration.

**dataDir resolution order:** `CLOE_DATA_DIR` environment variable → `dataDir` field in `config.json` → `~/.cloe` default.

### plugin-rules.json Format

```json
{
  "min_interval": 1.5,
  "tool_expressions": {
    "terminal": "working",
    "execute_code": "working",
    "write_file": "working",
    "read_file": null,
    "delegate_task": "working"
  },
  "tool_completions": {
    "delegate_task": "clap",
    "execute_code": "nod"
  },
  "keyword_map": [
    { "keywords": ["晚安", "睡了"], "action": "kiss" },
    { "keywords": ["哈哈", "笑死"], "action": "laugh" }
  ],
  "context_thresholds": {
    "warning": { "pct": 75, "action": "think" },
    "critical": { "pct": 90, "action": "shake_head" }
  }
}
```

**Field descriptions:**
- `min_interval`: Minimum interval between two actions (seconds), prevents rapid consecutive triggers
- `tool_expressions`: Expression triggered when a tool starts executing (`null` = no trigger, suitable for high-frequency tools like read_file)
- `tool_completions`: Expression triggered when a tool completes
- `keyword_map`: User message keyword → expression mapping (matched top to bottom; stops on first hit)
- `context_thresholds`: Context window usage thresholds — automatically triggers corresponding expression when exceeded

### Plugin Hook Listeners

| Hook | Trigger Timing | Default Action |
|------|---------------|----------------|
| `on_session_start` | New session | wave |
| `on_session_end` | Session ends (normally) | kiss |
| `on_session_end` | Session interrupted | shake_head |
| `on_session_reset` | /new reset | wave |
| `pre_tool_call` | Before tool execution | Per tool_expressions config |
| `post_tool_call` | After tool completes | Per tool_completions config / error→shake_head / >30s→yawn |
| `pre_llm_call` | Before LLM call | User message keyword matching |
| `post_llm_call` | After LLM call | turn >120s → yawn |
| `post_api_request` | After API request | Context usage exceeds threshold → think/shake_head |
| `subagent_stop` | Sub-agent completes | success→clap / failure→shake_head |

## Notes

- Allow at least 3–5 seconds between actions; triggering too quickly will cause the previous one to be interrupted (3-second reaction duration)
- When `clients=0`, curl won't error but actions will have no effect
- GIFs for non-default action sets are stored in `gifs/{setId}/` subdirectories; the `gifPath` returned by the API already includes the correct path
- `action-sets.json` supports hot reloading (fs.watch + debounce); the desktop updates automatically after external writes
- The plugin's `plugin-rules.json` also supports hot loading (5-second TTL cache); changes take effect without restarting Hermes
