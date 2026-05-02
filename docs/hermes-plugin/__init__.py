"""Cloe Desktop plugin — context-aware agent expressions.

Receives Hermes lifecycle hooks (CLI + gateway) and triggers GIF animations
on the Cloe Desktop widget via its HTTP bridge (localhost:19851).

Compared to the gateway hook (agent:start/end only), this plugin adds:
  - Per-tool expression mapping (pre_tool_call)
  - Duration-aware reactions (post_tool_call)
  - User message keyword matching (pre_llm_call)
  - Assistant response awareness (post_llm_call)
  - Context window usage tracking (post_api_request)
  - Subagent completion feedback (subagent_stop)
  - Session lifecycle (on_session_start/end/reset)
"""

from .handler import CloeDesktopBridge

_bridge = CloeDesktopBridge()


# ---------------------------------------------------------------------------
# Tool hooks
# ---------------------------------------------------------------------------

def _on_pre_tool_call(tool_name: str = "", args: dict = None, task_id: str = "", **kwargs):
    _bridge.on_pre_tool_call(tool_name, args, task_id)


def _on_post_tool_call(tool_name: str = "", args: dict = None, result: str = "",
                       task_id: str = "", duration_ms: int = 0, **kwargs):
    _bridge.on_post_tool_call(tool_name, args, result, task_id, duration_ms)


# ---------------------------------------------------------------------------
# LLM hooks
# ---------------------------------------------------------------------------

def _on_pre_llm_call(session_id: str = "", user_message: str = "",
                     conversation_history: list = None, is_first_turn: bool = False,
                     model: str = "", platform: str = "", **kwargs):
    _bridge.on_pre_llm_call(session_id, user_message, conversation_history,
                            is_first_turn, model, platform)


def _on_post_llm_call(session_id: str = "", user_message: str = "",
                      assistant_response: str = "", conversation_history: list = None,
                      model: str = "", platform: str = "", **kwargs):
    _bridge.on_post_llm_call(session_id, user_message, assistant_response,
                             conversation_history, model, platform)


# ---------------------------------------------------------------------------
# API request hook — token usage tracking
# ---------------------------------------------------------------------------

def _on_post_api_request(task_id: str = "", session_id: str = "", platform: str = "",
                         model: str = "", provider: str = "", base_url: str = "",
                         api_mode: str = "", api_call_count: int = 0,
                         api_duration: float = 0, finish_reason: str = "",
                         message_count: int = 0, response_model: str = None,
                         usage: dict = None, assistant_content_chars: int = 0,
                         assistant_tool_call_count: int = 0, **kwargs):
    _bridge.on_post_api_request(task_id, session_id, model, usage)


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

def _on_session_start(session_id: str = "", model: str = "", platform: str = "", **kwargs):
    _bridge.on_session_start(session_id, model, platform)


def _on_session_end(session_id: str = "", completed: bool = True, interrupted: bool = False,
                    model: str = "", platform: str = "", **kwargs):
    _bridge.on_session_end(session_id, completed, interrupted, model, platform)


def _on_session_reset(session_id: str = "", platform: str = "", **kwargs):
    _bridge.on_session_reset(session_id, platform)


# ---------------------------------------------------------------------------
# Subagent
# ---------------------------------------------------------------------------

def _on_subagent_stop(parent_session_id: str = "", child_role: str = None,
                      child_summary: str = None, child_status: str = "",
                      duration_ms: int = 0, **kwargs):
    _bridge.on_subagent_stop(parent_session_id, child_role, child_summary,
                             child_status, duration_ms)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register(ctx):
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("post_api_request", _on_post_api_request)
    ctx.register_hook("on_session_start", _on_session_start)
    ctx.register_hook("on_session_end", _on_session_end)
    ctx.register_hook("on_session_reset", _on_session_reset)
    ctx.register_hook("subagent_stop", _on_subagent_stop)
