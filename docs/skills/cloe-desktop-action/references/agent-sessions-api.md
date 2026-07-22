# Agent Session Tracker API

External agents (Claude Code, Hermes subagents, ZCode, etc.) can register sessions with Cloe Desktop to get TTS notifications and visual status tracking.

## Data Model

```json
{
  "id": "zcode-1784731016-6489",
  "source": "zcode",
  "source_label": "ZCode",
  "status": "working",
  "title": "Processing deploy scripts",
  "created_at": "2026-07-22T14:36:56.456Z",
  "last_updated": "2026-07-22T14:54:17.825Z",
  "turn_count": 2
}
```

### Session Statuses

| Status | Color | Pulse | Triggered By |
|--------|-------|-------|-------------|
| `working` | Blue | Yes | Agent registers or starts a new turn |
| `turn_complete` | Green | No | Agent finishes a turn (triggers TTS) |
| `needs_decision` | Orange | Yes | Agent needs user input (triggers TTS) |

## API Endpoints

### Register / Update Session

```bash
# Register a new session (auto-generates ID if not provided)
curl -s -X POST http://localhost:19851/agent-sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "zcode",
    "source_label": "ZCode",
    "title": "Running tests"
  }'

# Register with explicit ID (useful for hook scripts)
curl -s -X POST http://localhost:19851/agent-sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-agent-session-1",
    "source": "hermes",
    "source_label": "Hermes",
    "title": "Daily briefing"
  }'
```

**Parameters:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | No | Unique session ID. Auto-generated if omitted. Use explicit ID for hook integration. |
| `source` | Yes | Agent identifier (e.g. `zcode`, `hermes`, `copilot`) |
| `source_label` | No | Display name shown in UI. Falls back to `source`. |
| `title` | No | Session title shown in the panel. User-editable. |

**Response:**

```json
{
  "ok": true,
  "session": {
    "id": "agent-1784731016-abc123",
    "source": "zcode",
    "source_label": "ZCode",
    "status": "working",
    "title": "Running tests",
    "created_at": "2026-07-22T14:36:56.456Z",
    "last_updated": "2026-07-22T14:36:56.456Z",
    "turn_count": 0
  }
}
```

### List All Sessions

```bash
curl -s http://localhost:19851/agent-sessions
```

### Notify Turn Complete

Notifies that the agent has finished processing. Triggers TTS announcement.

```bash
curl -s -X POST http://localhost:19851/agent-sessions/SESSION_ID/turn-end \
  -H 'Content-Type: application/json' -d '{}'
```

### Notify Needs Decision

Notifies that the agent requires user input/confirmation. Triggers TTS announcement with higher urgency tone.

```bash
curl -s -X POST http://localhost:19851/agent-sessions/SESSION_ID/needs-decision \
  -H 'Content-Type: application/json' -d '{}'
```

### Set Session Title

```bash
curl -s -X POST http://localhost:19851/agent-sessions/SESSION_ID/title \
  -H 'Content-Type: application/json' \
  -d '{"title": "New title"}'
```

### Cancel Session (stop monitoring)

```bash
curl -s -X POST http://localhost:19851/agent-sessions/SESSION_ID/cancel
```

### End / Delete Session

```bash
curl -s -X DELETE http://localhost:19851/agent-sessions/SESSION_ID
```

## TTS Notifications

- **Turn complete**: Speaks `"{displayName}完成了一轮"` (turn completed)
- **Needs decision**: Speaks `"{displayName}需要你决策"` (needs your decision)
- `displayName` = session title if set, otherwise `source_label`
- Falls back to pre-recorded audio if dynamic TTS fails
- Honors the global mute toggle — no speech when muted

## Hook Integration Example (ZCode / Claude Code)

```bash
#!/bin/bash
BRIDGE="http://127.0.0.1:19851"
SESSION_ID="zcode-$$"

# SessionStart: register
curl -s -X POST "$BRIDGE/agent-sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"id\":\"$SESSION_ID\",\"source\":\"zcode\",\"source_label\":\"ZCode\"}"

# Stop (turn end): notify complete
curl -s -X POST "$BRIDGE/agent-sessions/$SESSION_ID/turn-end" \
  -H 'Content-Type: application/json' -d '{}'

# End: clean up
curl -s -X DELETE "$BRIDGE/agent-sessions/$SESSION_ID"
```

## Agent Panel

The Agent Sessions panel is accessible via a configurable keyboard shortcut (set in Cloe Desktop settings under the "Window" section). It shows all active sessions with:
- Real-time status indicators (pulsing dots for active states)
- Click session title to rename
- Click X to cancel monitoring
- ESC to close the panel

## Notes

- Sessions are **in-memory only** — they are lost on app restart
- POST to an existing session ID updates it without creating a duplicate
- TTS respects the global mute toggle
- The panel uses a minimal glass UI with transparent backdrop
