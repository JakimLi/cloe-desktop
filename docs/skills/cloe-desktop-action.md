     1|---
     2|name: cloe-desktop-action
     3|description: 通过 HTTP API 动态发现和触发 Cloe 桌面角色的表情动作动画
     4|---
     5|
     6|# Cloe Desktop Action — 桌面动画触发
     7|
     8|## 前置条件
     9|
    10|Cloe Desktop 必须在运行：
    11|
    12|```bash
    13|curl -s http://localhost:19851/status
    14|# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
    15|```
    16|
    17|## 动态发现可用动作
    18|
    19|**不要硬编码动作列表。** 通过 API 实时获取：
    20|
    21|```bash
    22|curl -s http://localhost:19851/actions
    23|curl -s http://localhost:19851/action-sets
    24|```
    25|
    26|`GET /actions` 返回含 `name`、`description`、`hookNames`、`special` 等字段的动作列表。用 `description` 匹配语境，用 `name` 或 `hookNames` 触发。
    27|
    28|## 触发动作
    29|
    30|```bash
    31|curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
    32|```
    33|
    34|动作播放约 3 秒后自动恢复 idle 循环。
    35|
    36|## 语音动作（speak）
    37|
    38|### 方式一：TTS 动态语音（推荐）
    39|
    40|链路：TTS 生成音频 → 保存到 `~/.cloe/audio_cache/` → bridge `/tts/` 路由 serve → speak 播放。
    41|
    42|#### 配置 TTS Provider
    43|
    44|配置文件：`~/.cloe/tts-config.json`
    45|
    46|```json
    47|{
    48|  "provider": "mosi",
    49|  "mosi": {
    50|    "api_key": "***",
    51|    "voice_id": "2036257587296473088",
    52|    "url": "https://studio.mosi.cn/v1/audio/tts"
    53|  },
    54|  "cosyvoice": {
    55|    "api_key_env": "BAILIAN_API_KEY",
    56|    "model": "cosyvoice-v1",
    57|    "voice": "longmiao"
    58|  }
    59|}
    60|```
    61|
    62|**provider 字段**选择 TTS 引擎：
    63|- `"mosi"` — MOSI 云端 TTS（可可音色，快 ~3s，有审核）**← 默认**
    64|- `"cosyvoice"` — 阿里云 CosyVoice（多音色可选）
    65|
    66|**MOSI 音色**（改 `voice_id`）：
    67|- `2036257587296473088` — 陈可可（默认）
    68|- `2042261353581776896` — 陈可可（备用）
    69|
    70|**CosyVoice 音色**（改 `voice`）：
    71|- `longmiao`（可爱）、`loongstella`（年轻）、`loongbella`（甜美）、`longyue`（温柔）、`longjing`（清亮）
    72|
    73|#### 生成 + 播放
    74|
    75|**步骤 1：生成音频**（必须用 terminal，SDK 只在系统 Python）
    76|
    77|根据 `~/.cloe/tts-config.json` 的 `provider` 字段自动选择 TTS 引擎生成音频，保存到 `~/.cloe/audio_cache/tts_<timestamp>.wav`（mosi）或 `.mp3`（cosyvoice）。输出文件名到 stdout。
    78|
    79|**MOSI TTS 调用方式**：POST `https://studio.mosi.cn/v1/audio/tts`，body: `{"model":"moss-tts","text":"...","voice_id":"2036257587296473088","sampling_params":{"temperature":1.7,"top_p":0.8,"top_k":25}}`，header: `Authorization: Bearer *** wav 二进制。
    80|
    81|**CosyVoice TTS 调用方式**：dashscope SDK `SpeechSynthesizer(model="cosyvoice-v1", voice="longmiao")`，API key 从 `BAILIAN_API_KEY` 读取。
    82|
    83|**步骤 2：触发 speak**
    84|
    85|```bash
    86|curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>"}'
    87|```
    88|
    89|- Bridge `GET /tts/:filename` serve `~/.cloe/audio_cache/`
    90|- Renderer 等音频播完才回 idle（不受 3 秒限制）
    91|- **TTS 文本格式**：完整连贯句子，少用省略号/波浪号/感叹号
    92|
    93|### 方式二：预录语音（`audio` 字段）
    94|
    95|```bash
    96|curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
    97|```
    98|
    99|走 3 秒固定 timer。添加新语音：TTS 生成 → `ffmpeg` 转 mp3 → 放 `public/audio/`
   100|
   101|### 方式三：data URL（短音频，<5s）
   102|
   103|base64 编码后传 `data:audio/mpeg;base64,...`，curl 上限约 128KB。
   104|
   105|## 系统动作
   106|
   107|| 动作 | 触发方式 | 说明 |
   108||------|---------|------|
   109|| `working` | hook agent:start | 敲键盘，锁定工作模式 |
   110|| `idle` | hook agent:end | 恢复 idle 循环 |
   111|| `wave` | hook session:start | 新会话打招呼 |
   112|| `kiss` | hook session:end | 会话结束 |
   113|
   114|## Hermes Plugin（自动触发）
   115|
   116|`~/.hermes/plugins/cloe-desktop/` 监听生命周期事件自动触发表情。
   117|
   118|### 触发规则（plugin-rules.json）
   119|
   120|存在 `~/.cloe/plugin-rules.json`，5 秒缓存自动刷新。
   121|
   122|```json
   123|{
   124|  "min_interval": 1.5,
   125|  "tool_expressions": {"terminal": "think", "execute_code": "think", "read_file": null},
   126|  "tool_completions": {"delegate_task": "clap", "execute_code": "nod"},
   127|  "keyword_map": [
   128|    {"keywords": ["晚安", "睡了"], "action": "kiss"}
   129|  ],
   130|  "context_thresholds": {
   131|    "warning": {"pct": 75, "action": "think"},
   132|    "critical": {"pct": 90, "action": "shake_head"}
   133|  }
   134|}
   135|```
   136|
   137|### Plugin 监听的 Hooks
   138|
   139|| Hook | 时机 | 动作 |
   140||------|------|------|
   141|| on_session_start | 新 session | wave |
   142|| on_session_end | 正常结束 | kiss |
   143|| on_session_end | 被中断 | shake_head |
   144|| pre_tool_call | 工具执行前 | 按 tool_expressions |
   145|| post_tool_call | 工具完成后 | 按 tool_completions |
   146|| pre_llm_call | LLM 调用前 | 关键词匹配 |
   147|| post_llm_call | LLM 调用后 | idle + 超长→yawn |
   148|| post_api_request | API 请求后 | context 阈值 |
   149|| subagent_stop | 子 agent 完成 | 成功→clap / 失败→shake_head |
   150|
   151|## 注意事项
   152|
   153|- 动作间隔至少 3-5 秒，太快会被打断
   154|- `clients=0` 时动作不生效
   155|- `action-sets.json` 和 `plugin-rules.json` 都支持热加载
   156|