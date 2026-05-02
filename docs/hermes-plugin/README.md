# Hermes Plugin — Cloe Desktop Auto-Expressions

A Hermes lifecycle plugin that automatically triggers Cloe Desktop expressions
based on tool calls, LLM turns, user keywords, and context window usage.

## Install

```bash
# Copy (or symlink) the plugin into Hermes plugins directory
cp -r . ~/.hermes/plugins/cloe-desktop/
```

## How It Works

The plugin listens to Hermes lifecycle hooks and sends HTTP POST requests to the
Cloe Desktop bridge (`localhost:19851/action`).

### Trigger Rules

Rules are **not hardcoded** — they're loaded from `<dataDir>/plugin-rules.json`
(default `~/.cloe/plugin-rules.json`), with a 5-second cache TTL.

**dataDir resolution**: `CLOE_DATA_DIR` env → `config.json` `dataDir` field → `~/.cloe`.

### plugin-rules.json Format

```json
{
  "min_interval": 1.5,
  "tool_expressions": {
    "terminal": "working",
    "execute_code": "working",
    "write_file": "working",
    "patch": "working",
    "read_file": null,
    "search_files": null
  },
  "tool_completions": {
    "delegate_task": "clap",
    "execute_code": "nod"
  },
  "keyword_map": [
    { "keywords": ["thank", "thanks"], "action": "smile" },
    { "keywords": ["goodnight"], "action": "kiss" }
  ],
  "context_thresholds": {
    "warning": { "pct": 75, "action": "think" },
    "critical": { "pct": 90, "action": "shake_head" }
  }
}
```

### Hooks

| Hook | When | Default Action |
|------|------|---------------|
| `on_session_start` | New session | wave |
| `on_session_end` | Session ends (normal) | kiss |
| `on_session_end` | Session interrupted | shake_head |
| `on_session_reset` | `/new` reset | wave |
| `pre_tool_call` | Before tool runs | Per `tool_expressions` config |
| `post_tool_call` | After tool completes | Per `tool_completions` / error→shake_head / >30s→yawn |
| `pre_llm_call` | Before LLM call | User message keyword matching |
| `post_llm_call` | After LLM call | turn >120s → yawn |
| `post_api_request` | After API request | context usage threshold → think/shake_head |
| `subagent_stop` | Subagent done | success→clap / failure→shake_head |

## Configuring Rules

Use the **Plugin Rules** tab in the Cloe Desktop Manager UI, or edit
`~/.cloe/plugin-rules.json` directly (changes take effect within 5 seconds).
