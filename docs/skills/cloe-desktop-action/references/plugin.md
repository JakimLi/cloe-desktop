# Hermes Plugin 自动触发

`~/.hermes/plugins/cloe-desktop/` 监听 Hermes 生命周期事件，自动触发 Cloe 表情动作。

## 触发规则

配置文件：`~/.cloe/plugin-rules.json`（5 秒缓存自动刷新）

```json
{
  "min_interval": 1.5,
  "tool_expressions": {},
  "tool_completions": { "delegate_task": "clap", "execute_code": "nod" },
  "keyword_map": [
    { "keywords": ["晚安", "睡了"], "action": "kiss" }
  ],
  "context_thresholds": {
    "warning": { "pct": 75, "action": "think" },
    "critical": { "pct": 90, "action": "shake_head" }
  }
}
```

- `min_interval`：两次动作之间最小间隔（秒）
- `tool_expressions`：工具执行前的表情映射（当前 working 由 `pre_llm_call` 触发，不需要 per-tool）
- `tool_completions`：工具完成后的表情映射
- `keyword_map`：关键词匹配列表，命中时触发对应动作
- `context_thresholds`：上下文用量阈值触发（`pct` 为百分比）

## Hook 监听表

| Hook | 时机 | 动作 |
|------|------|------|
| `on_session_start` | 新 session | wave |
| `on_session_end` | 正常结束 | kiss |
| `on_session_end` | 被中断 | shake_head |
| `pre_tool_call` | 工具执行前 | 按 `tool_expressions` |
| `post_tool_call` | 工具完成后 | 按 `tool_completions` |
| `pre_llm_call` | LLM 调用前 | working |
| `post_llm_call` | LLM 调用后 | idle（超长→yawn） |
| `post_api_request` | API 请求后 | context 阈值检查 |
| `subagent_stop` | 子 agent 完成 | 成功→clap / 失败→shake_head |

## 热加载说明

- `plugin-rules.json`：5 秒 TTL 缓存，修改后自动刷新
- `plugin.yaml` 的 hooks 配置：**不支持热加载**，修改后必须重启 Hermes gateway 进程（gateway 模式）或 TUI 进程（`hermes --tui`）

## Gateway hooks vs Plugin hooks

| | Gateway hooks | Plugin hooks |
|---|---|---|
| 位置 | `~/.hermes/hooks/` | `~/.hermes/plugins/` |
| 触发范围 | 仅 GatewayRunner | 所有模式（gateway、TUI、直接调用） |
| TUI 兼容 | ❌ TUI 下不触发 | ✅ 所有模式都触发 |

因此，working/idle 等关键动作**必须依赖 plugin hooks**，不能只依赖 gateway hooks。
