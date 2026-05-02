# Cloe Desktop — Documentation

## Integration with AI Agents

Cloe Desktop can be controlled by AI agents (Hermes, custom scripts, etc.) via
its HTTP API (`localhost:19851`).

### Quick Start

```bash
# Check if Cloe Desktop is running
curl -s http://localhost:19851/status

# Trigger an expression
curl -s http://localhost:19851/action -d '{"action":"smile"}'

# Discover available actions
curl -s http://localhost:19851/actions
```

### Components

| Component | Path | Purpose |
|-----------|------|---------|
| [Hermes Plugin](./hermes-plugin/) | `~/.hermes/plugins/cloe-desktop/` | Auto-expressions on tool calls, LLM turns, keywords |
| [Gateway Hook](./hermes-hook/) | `~/.hermes/hooks/cloe-desktop/` | Working mode on agent start/stop |
| [Skills](./skills/) | Reference docs | API docs, GIF generation, troubleshooting |

### Configuration

- **Action sets**: `~/.cloe/action-sets.json` — define character appearances and actions
- **Plugin rules**: `~/.cloe/plugin-rules.json` — configure auto-expression triggers
- **General settings**: `~/.cloe/config.json` — API keys, data directory, language

All configuration files can be edited via the Manager UI (tray icon → Settings).
