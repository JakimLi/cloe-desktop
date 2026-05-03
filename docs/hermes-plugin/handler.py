"""Cloe Desktop bridge — translates Hermes lifecycle events to GIF animations.

Sends HTTP POST requests to the Cloe Desktop bridge (localhost:19851/action).
All requests are fire-and-forget with a 2s timeout.

Trigger rules are loaded from <dataDir>/plugin-rules.json (shared with Manager UI).
Falls back to sensible defaults if the file is missing or malformed.
"""

import json
import logging
import os
import time
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

BRIDGE_URL = "http://127.0.0.1:19851/action"
STATUS_URL = "http://127.0.0.1:19851/status"

# Config resolution: read dataDir from <dataDir>/config.json, default ~/.cloe
_DEFAULT_DATA_DIR = os.path.expanduser("~/.cloe")

# Throttle: minimum seconds between action triggers (avoid spamming during rapid tool calls).
_DEFAULT_MIN_INTERVAL = 1.5

# Well-known context window limits by model prefix (approximate).
_MODEL_CONTEXT_LIMITS = {
    "GLM": 128_000,
    "glm": 128_000,
    "anthropic/claude": 200_000,
    "claude-sonnet": 200_000,
    "claude-opus": 200_000,
    "gpt-4": 128_000,
    "gpt-4o": 128_000,
    "o1": 200_000,
    "o3": 200_000,
    "deepseek": 128_000,
    "qwen": 131_072,
}

# ── Default trigger rules (used when plugin-rules.json is absent) ──────────

_DEFAULT_RULES = {
    "min_interval": _DEFAULT_MIN_INTERVAL,
    "tool_expressions": {
        "terminal": "working",
        "execute_code": "working",
        "write_file": "working",
        "patch": "working",
        "read_file": None,
        "search_files": None,
        "web_search": "working",
        "browser_navigate": "working",
        "browser_click": "working",
        "delegate_task": "working",
        "send_message": "working",
        "vision_analyze": "working",
    },
    "tool_completions": {
        "delegate_task": "clap",
        "execute_code": "nod",
    },
    "keyword_map": [
        {"keywords": ["谢谢", "感谢", "thank", "thanks"], "action": "smile"},
        {"keywords": ["晚安", "goodnight", "睡了", "去睡了"], "action": "kiss"},
        {"keywords": ["哈哈", "笑死", "lol", "haha", "😂", "🤣"], "action": "laugh"},
        {"keywords": ["你好", "hi", "hello", "早上好", "早安", "morning"], "action": "wave"},
        {"keywords": ["笨", "蠢", "傻", "stupid"], "action": "tease"},
        {"keywords": ["抱歉", "对不起", "sorry"], "action": "shake_head"},
        {"keywords": ["厉害", "棒", "awesome", "amazing", "great"], "action": "clap"},
        {"keywords": ["害羞", "脸红", "shy", " blush"], "action": "shy"},
    ],
    "context_thresholds": {
        "warning": {"pct": 75, "action": "think"},
        "critical": {"pct": 90, "action": "shake_head"},
    },
}


def _resolve_data_dir() -> str:
    """Resolve Cloe data directory.

    Priority:
      1. CLOE_DATA_DIR env var
      2. config.json → dataDir field
      3. ~/.cloe default
    """
    env = os.environ.get("CLOE_DATA_DIR")
    if env:
        return os.path.expanduser(env)

    # Try reading config.json from the default location first
    cfg_path = os.path.join(_DEFAULT_DATA_DIR, "config.json")
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        dd = cfg.get("dataDir")
        if dd and dd.strip():
            return os.path.expanduser(dd)
    except (OSError, json.JSONDecodeError):
        pass

    return _DEFAULT_DATA_DIR


def _load_rules(data_dir: str) -> dict:
    """Load plugin-rules.json from data_dir, merge with defaults."""
    rules_path = os.path.join(data_dir, "plugin-rules.json")
    try:
        with open(rules_path, "r", encoding="utf-8") as f:
            user_rules = json.load(f)
    except (OSError, json.JSONDecodeError):
        return _DEFAULT_RULES.copy()

    # Shallow merge: user values override defaults
    merged = _DEFAULT_RULES.copy()
    for key in ("min_interval", "tool_expressions", "tool_completions",
                "keyword_map", "context_thresholds"):
        if key in user_rules:
            merged[key] = user_rules[key]
    return merged


def _trigger(action: str, audio: Optional[str] = None) -> None:
    """POST a JSON action to the Cloe Desktop bridge. Fire-and-forget."""
    try:
        payload = {"action": action}
        if audio:
            payload["audio"] = audio
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            BRIDGE_URL,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Desktop not running — silently skip


def _guess_context_limit(model: str) -> int:
    """Guess context window size from model name."""
    for prefix, limit in _MODEL_CONTEXT_LIMITS.items():
        if prefix in (model or "").lower():
            return limit
    return 128_000  # default assumption


class CloeDesktopBridge:
    """Stateful bridge that throttles, deduplicates, and tracks context usage."""

    _CONFIG_TTL = 5.0  # seconds to cache rules before re-reading

    def __init__(self):
        self._last_action_time = 0.0
        self._last_action = ""
        self._turn_tool_count = 0
        self._turn_start_time = 0.0
        # Context usage tracking
        self._last_prompt_tokens = 0
        self._last_context_limit = 128_000
        self._last_usage_pct = 0.0
        # Config cache
        self._data_dir = _resolve_data_dir()
        self._rules_cache = None
        self._rules_loaded_at = 0.0
        logger.info("[cloe-desktop-plugin] data_dir=%s", self._data_dir)

    def _rules(self) -> dict:
        """Get current rules (cached with TTL)."""
        now = time.monotonic()
        if self._rules_cache is None or (now - self._rules_loaded_at) > self._CONFIG_TTL:
            self._rules_cache = _load_rules(self._data_dir)
            self._rules_loaded_at = now
        return self._rules_cache

    def _trigger_action(self, action: str, audio: Optional[str] = None,
                        force: bool = False) -> None:
        """Trigger an action with throttle protection."""
        if not action or action == "none":
            return

        rules = self._rules()
        min_interval = rules.get("min_interval", _DEFAULT_MIN_INTERVAL)
        now = time.monotonic()

        # Skip if same action was just triggered recently (unless forced)
        if not force and action == self._last_action and (now - self._last_action_time) < min_interval:
            return
        # Skip if any action was triggered too recently (unless forced)
        if not force and (now - self._last_action_time) < min_interval:
            return

        self._last_action_time = now
        self._last_action = action
        _trigger(action, audio)
        logger.debug("[cloe-desktop-plugin] → %s", action)

    @property
    def context_usage_pct(self) -> float:
        """Current context window usage as percentage (0-100)."""
        return self._last_usage_pct

    @property
    def context_usage_info(self) -> dict:
        """Full context usage info for external consumers."""
        return {
            "prompt_tokens": self._last_prompt_tokens,
            "context_limit": self._last_context_limit,
            "usage_pct": round(self._last_usage_pct, 1),
        }

    # ------------------------------------------------------------------
    # API request hook — token usage
    # ------------------------------------------------------------------

    def on_post_api_request(self, task_id: str, session_id: str,
                            model: str, usage: Optional[dict]) -> None:
        """After every API call — track context window usage."""
        if not usage:
            return

        prompt_tokens = usage.get("prompt_tokens", 0)
        if not prompt_tokens:
            return

        context_limit = _guess_context_limit(model)
        usage_pct = (prompt_tokens / context_limit * 100) if context_limit else 0

        self._last_prompt_tokens = prompt_tokens
        self._last_context_limit = context_limit
        self._last_usage_pct = usage_pct

        logger.info(
            "[cloe-desktop-plugin] context usage: %d/%d tokens (%.1f%%)",
            prompt_tokens, context_limit, usage_pct,
        )

        # React to high context usage
        rules = self._rules()
        thresholds = rules.get("context_thresholds", {})
        critical = thresholds.get("critical", {})
        warning = thresholds.get("warning", {})

        if usage_pct > critical.get("pct", 90):
            self._trigger_action(critical.get("action", "shake_head"), force=True)
        elif usage_pct > warning.get("pct", 75):
            self._trigger_action(warning.get("action", "think"), force=True)

    # ------------------------------------------------------------------
    # Tool hooks
    # ------------------------------------------------------------------

    def on_pre_tool_call(self, tool_name: str, args: dict, task_id: str) -> None:
        """Before a tool executes — show a contextual expression."""
        rules = self._rules()
        expression = rules.get("tool_expressions", {}).get(tool_name)
        if expression:
            self._trigger_action(expression)

    def on_post_tool_call(self, tool_name: str, args: dict, result: str,
                          task_id: str, duration_ms: int) -> None:
        """After a tool completes — react to result and duration."""
        # Long-running tool → yawn
        if duration_ms > 30_000:
            self._trigger_action("yawn", force=True)
            return

        # Tool-specific completion reaction
        rules = self._rules()
        reaction = rules.get("tool_completions", {}).get(tool_name)
        if reaction:
            self._trigger_action(reaction)
            return

        # Error detection
        if result and isinstance(result, str):
            lower = result.lower()
            if '"error"' in lower or "traceback" in lower or "exit_code" in lower:
                try:
                    parsed = json.loads(result) if result.startswith("{") else {}
                    if isinstance(parsed, dict) and parsed.get("exit_code", 0) != 0:
                        self._trigger_action("shake_head")
                except (json.JSONDecodeError, AttributeError):
                    pass

    # ------------------------------------------------------------------
    # LLM hooks
    # ------------------------------------------------------------------

    def on_pre_llm_call(self, session_id: str, user_message: str,
                        conversation_history: list, is_first_turn: bool,
                        model: str, platform: str) -> None:
        """Before the LLM loop — react to user message content."""
        self._turn_tool_count = 0
        self._turn_start_time = time.monotonic()

        if not user_message:
            return

        # First turn → wave
        if is_first_turn:
            self._trigger_action("wave", force=True)

        # Keyword matching from rules
        rules = self._rules()
        lower = user_message.lower()
        for entry in rules.get("keyword_map", []):
            keywords = entry.get("keywords", [])
            action = entry.get("action")
            if action and any(kw in lower for kw in keywords):
                self._trigger_action(action, force=True)
                return

    def on_post_llm_call(self, session_id: str, user_message: str,
                         assistant_response: str, conversation_history: list,
                         model: str, platform: str) -> None:
        """After the LLM loop completes — exit working mode, react to turn."""
        turn_duration = time.monotonic() - self._turn_start_time if self._turn_start_time else 0

        # Exit working mode — resume idle loop on desktop.
        # pre_tool_call sets isWorking=true; this is the matching release.
        # MUST use force=True to bypass throttle: post_tool_call reactions
        # (e.g. "nod" for execute_code) may have fired just milliseconds
        # ago, and without force the throttle would silently drop this
        # critical "idle" transition, leaving the character stuck in
        # working mode indefinitely.
        self._trigger_action("idle", force=True)

        # Very long turn → yawn (after idle, so it plays as a reaction)
        if turn_duration > 120:
            self._trigger_action("yawn")

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    def on_session_start(self, session_id: str, model: str, platform: str) -> None:
        """New session → wave hello."""
        self._trigger_action("wave", force=True)

    def on_session_end(self, session_id: str, completed: bool, interrupted: bool,
                       model: str, platform: str) -> None:
        """Session end → ensure idle + kiss if completed normally."""
        # Always force idle on session end as a safety net — if the turn
        # failed or was interrupted, post_llm_call may not have fired.
        self._trigger_action("idle", force=True)

        if completed and not interrupted:
            self._trigger_action("kiss", force=True)
        elif interrupted:
            self._trigger_action("shake_head", force=True)

    def on_session_reset(self, session_id: str, platform: str) -> None:
        """Session reset (e.g. /new) → wave hello again."""
        self._trigger_action("wave", force=True)

    # ------------------------------------------------------------------
    # Subagent
    # ------------------------------------------------------------------

    def on_subagent_stop(self, parent_session_id: str, child_role: Optional[str],
                         child_summary: Optional[str], child_status: str,
                         duration_ms: int) -> None:
        """Subagent completed → clap if successful."""
        if child_status == "completed":
            self._trigger_action("clap")
        elif child_status in ("failed", "error"):
            self._trigger_action("shake_head")
