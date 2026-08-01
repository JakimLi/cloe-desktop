# Cloe Desktop Native Agent — Memory & Coding Tools 升级提示词

## 项目背景

Cloe Desktop 是一个 Electron 桌面 AI 伴侣应用。其中 `native-agent/` 目录是一个独立的 agent runtime，基于 `@earendil-works/pi-agent-core` 框架，不依赖外部进程。

### 核心文件结构

```
native-agent/
├── agent.js      (547行) — AgentSession 类，管理 Pi Agent 实例、上下文、重试、thinking
├── tools.js      (504行) — 工具定义和执行（terminal, file_read, file_write, file_search, web_search, web_read, load_skill, memory, cloe_action, cloe_tts）
├── memory.js     (146行) — 记忆存储，JSON 文件持久化
├── config.js     (176行) — 配置管理，~/.cloe/native-agent.json
├── paths.js      (72行)  — 统一路径管理，~/.cloe/ 优先，~/.hermes/ fallback
├── skills.js     (159行) — Skill 发现和加载
├── soul.js       (138行) — 灵魂文件加载 + system prompt 构建
├── web-search.js (467行) — 多 provider 搜索引擎（zhipu_mcp/tavily/ddg/bing/serpapi）
└── cron.js       (310行) — 定时任务
```

### 工具调用机制

tools.js 导出 `getTools()` 返回工具定义数组（OpenAI function calling 格式），和 `executeTool(name, args)` 执行工具。
agent.js 的 `AgentSession.run()` 创建 Pi Agent 实例，注册工具，处理流式事件（text delta, thinking delta, tool call, tool result, turn end, agent end）。

### Pi Agent Core 的 AgentTool 接口

```typescript
interface AgentTool {
  name: string;
  description: string;
  schema: JSONSchema;  // JSON Schema for parameters
  execute(args: object): Promise<string>;
}
```

Pi Agent 支持 `transformContext` hook（每次 LLM 调用前执行）、thinking levels（off/minimal/low/medium/high/xhigh/max）、自动 compaction。

---

## 升级任务 A：Memory 系统重构

### 当前实现的问题

`native-agent/memory.js` 现状：
- 存储在 `~/.cloe/native-agent-memory.json`，纯 JSON 数组
- 最多 50 条，超过时按 `trust × last_used` 淘汰
- trust 初始 0.5，但代码中**没有任何地方调用 setTrust()**，所以 trust 永远不变
- 搜索是简单的 `content.includes(query)` 子串匹配
- 注入 system prompt 时最多 4000 字符
- render() 每次调用都会 saveMemory()（更新 last_used），有性能问题

### 目标设计：分层记忆 + 衰减遗忘

#### 1. 分类策略

```
user_pref  — 用户偏好/个人信息（永不淘汰，上限 100 条，全量注入）
project    — 项目相关知识（LRU 衰减，上限 100 条）
tool       — 工具使用经验（LRU 衰减，上限 80 条）
general    — 一般知识（LRU 衰减，上限 50 条）
```

#### 2. Trust 动态衰减

- 新记忆初始 trust = 0.5
- 每次 render() 注入时 trust += 0.02（使用即强化）
- 每次 search() 命中时 trust += 0.1
- 每天 trust -= 0.01（时间衰减），最低 0.1
- trust < 0.05 且非 user_pref → 自动淘汰

#### 3. 注入策略

```
system prompt 注入预算 = 6000 字符
优先级: user_pref 全注入 → tool 按 trust 降序 → project 按 trust 降序 → general 按 trust 降序
直到用完预算
```

#### 4. 搜索优化

- 子串匹配保留（快）
- 加 tag 匹配（add 时可以打标签）
- 返回结果按 trust + recency 综合排序

#### 5. 数据结构

```json
{
  "version": 2,
  "entries": [
    {
      "id": "uuid",
      "content": "记忆内容",
      "category": "user_pref",
      "tags": ["name", "personal"],
      "trust": 0.8,
      "created_at": 1699000000000,
      "last_used": 1699000000000,
      "use_count": 5
    }
  ],
  "last_decay": 1699000000000
}
```

#### 6. 迁移

检测到 v1 格式（无 version 字段或 version !== 2）时自动迁移，所有现有记忆设 category = "general"，trust = 0.5。

#### 7. 性能

- render() 不再每次 saveMemory()，改为只在 trust 变化超过阈值（0.05）时写入
- 或者用 dirty flag + 延迟写入（30 秒一次 flush）

### 接口保持兼容

外部调用方式不变：
```js
memory.add(content, category, tags)  // tags 改为可选字符串或数组
memory.remove(idOrContent)
memory.search(query)
memory.render()  // → string for system prompt
```

tools.js 中的 memory 工具定义不变，但 execute 里可以传 tags 参数。

---

## 升级任务 B：Coding 能力增强

### 当前问题

1. **file_write 是全量覆盖** — 整个文件重写，容易误改不该改的内容，且浪费 token
2. **没有 file_edit 工具** — 无法做精确的局部修改
3. **工具串行执行** — 多个独立工具调用不能并行
4. **没有自动验证** — 改完代码不会自动检查语法或运行测试
5. **缺少目录浏览** — 没有 ls/tree 工具，了解项目结构全靠 grep/find

### 目标设计

#### B1. 新增 file_edit 工具（最重要）

基于 diff 的精确文件编辑，支持两种模式：

**模式 1：行替换**
```json
{
  "name": "file_edit",
  "parameters": {
    "path": "文件路径",
    "edits": [
      {
        "oldText": "要替换的原文（必须精确匹配，包含上下文行）",
        "newText": "替换后的新文本"
      }
    ]
  }
}
```

实现逻辑：
1. 读取文件内容
2. 对每个 edit，在文件中搜索 oldText
3. 如果精确匹配到一个位置 → 替换
4. 如果匹配到多个位置 → 报错，要求提供更多上下文
5. 如果匹配不到 → 报错，返回最相似的行（帮助 debugging）
6. 所有 edits 应用后写回文件
7. 返回 diff 摘要（改了几处，每处 +/- 行数）

关键：oldText 必须是**唯一匹配**的，否则报错。这强制 LLM 提供足够上下文。

**模式 2：行号编辑（备选）**
```json
{
  "path": "文件路径",
  "lineEdits": [
    { "startLine": 10, "endLine": 15, "newText": "新内容" }
  ]
}
```

#### B2. 新增 list_files 工具

```json
{
  "name": "list_files",
  "parameters": {
    "path": "目录路径（默认 ~）",
    "recursive": false,
    "maxDepth": 2
  }
}
```

返回目录树，帮助 LLM 了解项目结构。排除 node_modules/.git/dist 等。

#### B3. 工具执行后自动验证

在 tools.js 的 executeTool 中，特定工具执行后自动追加验证：

```js
// file_write 或 file_edit 对 .js/.jsx/.ts 文件操作后
if (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts')) {
  const check = await runShell(`node -c "${p}"`, 5000);
  if (check.includes('SyntaxError')) {
    return result + `\n\n⚠️ Syntax check failed:\n${check}`;
  }
}
```

#### B4. file_read 增强

- 默认返回带行号的内容（已有）
- 加 `maxLines` 参数限制返回行数（防止读取超大文件撑爆 context）
- 如果文件超过 maxLines，返回前 N 行 + `... (N more lines, use offset to read more)`

#### B5. file_write 增加 backup

写入前备份原文件到内存（不持久化），如果同一次 run 中 file_write 后发生错误，可以在 retry 时恢复。

### 关于并行工具调用

Pi Agent Core 框架层面的并行需要修改 harness，本次不做。但可以在 executeTool 层面加一个 `executeToolsBatch(toolCalls)` 批量执行函数，用 Promise.all 并行执行无依赖关系的工具调用。

---

## 实现要求

1. **纯 Node.js (CommonJS)**，不引入新的 npm 依赖
2. **不修改 pi-agent-core 的源码**，只改 native-agent/ 目录下的文件
3. **tools.js 的工具定义格式**兼容 OpenAI function calling（type: 'function', function: { name, description, parameters }）
4. **保持向后兼容**：现有配置文件、memory 文件、session 数据格式不能 break
5. **代码风格**：跟现有代码一致，'use strict'，JSDoc 注释，console.log 带 `[NativeAgent]` 前缀
6. **测试**：写完跑 `node -e "require('./native-agent/memory')"` 和 `require('./native-agent/tools')` 确认无语法错误
7. **不要动这些文件**：agent.js 的 AgentSession 类结构和 run() 方法签名保持不变，只增不改

## 项目路径

```
/Users/lijian/work/cloe-desktop/
```

配置文件：`~/.cloe/native-agent.json`
Memory 文件：`~/.cloe/native-agent-memory.json`
Soul 文件：`~/.hermes/soul.md`（fallback from `~/.cloe/soul.md`）
Skills 目录：`~/.hermes/skills/`（fallback from `~/.cloe/skills/`）
