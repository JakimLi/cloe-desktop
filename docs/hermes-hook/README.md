# Hermes Gateway Hook — Cloe Desktop Working Mode

A lightweight gateway-level hook that locks the desktop character into "working"
mode while the Hermes agent is active.

## Install

```bash
# Copy (or symlink) into Hermes hooks directory
cp -r . ~/.hermes/hooks/cloe-desktop/
```

## Events

| Event | Action | Description |
|-------|--------|-------------|
| `agent:start` | `working` | Lock character into working GIF |
| `agent:end` | `idle` | Resume normal idle loop |

## Why a Separate Hook?

The gateway hook handles **process-level** events (agent process start/stop).
Session-level events (wave, kiss, tool reactions, keyword matching) are handled
by the [Hermes Plugin](../hermes-plugin/).

**No overlap**: this hook only does `agent:start → working` and `agent:end → idle`,
which the plugin cannot detect (it only sees session-level hooks).

## Restart Required

After modifying the hook, restart the Hermes gateway:
```bash
hermes gateway restart
# Or delete pycache first:
rm -rf ~/.hermes/hooks/cloe-desktop/__pycache__
hermes gateway restart
```
