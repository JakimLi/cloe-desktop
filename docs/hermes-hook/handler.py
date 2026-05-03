"""
Cloe Desktop — Gateway lifecycle hook.

Fires GIF animations on the Cloe Desktop widget via its HTTP API (localhost:19851).

Only handles gateway-level (process) events:
  - agent:start   → working mode (lock on working.gif)
  - agent:end     → idle mode (resume normal idle loop)
  - agent:error   → idle mode (recovery on crash/interrupt)

Session-level events (wave, kiss, tool reactions, keyword matching, etc.)
are handled by the cloe-desktop plugin (~/.hermes/plugins/cloe-desktop/).
"""

import json
import logging
import urllib.request

logger = logging.getLogger(__name__)

BRIDGE_URL = "http://127.0.0.1:19851/action"


def _trigger(action: dict) -> None:
    """POST a JSON action to the Cloe Desktop bridge. Fire-and-forget."""
    try:
        payload = json.dumps(action).encode("utf-8")
        req = urllib.request.Request(
            BRIDGE_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Desktop not running — silently skip


def handle(event_type: str, context: dict):
    """Called by the Gateway hook registry for each subscribed event."""

    if event_type == "agent:start":
        _trigger({"action": "working"})
        logger.debug("[cloe-desktop] agent:start → working")

    elif event_type == "agent:end":
        _trigger({"action": "idle"})
        logger.debug("[cloe-desktop] agent:end → idle")

    elif event_type == "agent:error":
        # Emitted when the agent crashes or the turn is interrupted.
        # Guarantees the character returns to idle even on failure.
        _trigger({"action": "idle"})
        logger.debug("[cloe-desktop] agent:error → idle (recovery)")
