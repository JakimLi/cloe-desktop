# 任务管理 API

通过 Bridge API 创建和管理任务列表，支持计时（tracking 每个任务投入的时间）、完成/重开、优先级排序。任务列表会在角色的任务面板里实时显示。

## 数据模型

```json
{
  "id": "task_1719400000000_abc12",
  "title": "写文档",
  "content": "补全 weather 和 tasks 的 API 文档",
  "status": "pending",
  "created_at": "2026-07-26T10:00:00.000Z",
  "updated_at": "2026-07-26T10:00:00.000Z",
  "completed_at": null,
  "elapsed_seconds": 0
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 自动生成（`task_<时间戳>_<随机>`），创建时可自传 |
| `title` | string | 标题（必填，空则用 `'Untitled'`） |
| `content` | string | 详情/备注（可选） |
| `status` | string | `pending`（待办）\| `timing`（计时中）\| `completed`（已完成） |
| `created_at` | string | 创建时间 ISO |
| `updated_at` | string | 最后更新时间 ISO |
| `completed_at` | string\|null | 完成时间 ISO（未完成为 null） |
| `elapsed_seconds` | number | 累计已计时秒数（多次 start/stop 会累加） |

## 排序规则

- 任务有**优先级顺序**（`order` 数组），靠前的优先级更高
- 活跃任务（pending/timing）排在前面，已完成（completed）排在后面
- 新建任务插入到活跃区末尾（已完成区之前）
- `GET /tasks` 和 `POST /tasks/reorder` 返回的列表都是按此规则排序后的

## API 端点

### 列出所有任务

```bash
curl -s http://localhost:19851/tasks
# {"tasks": [...], "timing_id": null}
```

`timing_id` 是当前正在计时的任务 id（同一时刻最多一个任务在计时），没有则为 `null`。

### 创建任务

```bash
curl -s -X POST http://localhost:19851/tasks -H 'Content-Type: application/json' \
  -d '{"title":"写文档","content":"补全 API 文档"}'

# 自定义 id
curl -s -X POST http://localhost:19851/tasks -H 'Content-Type: application/json' \
  -d '{"id":"my-task-1","title":"Review PR"}'
```

### 更新任务

只能改 `title` 和 `content`（状态变更请用下方的 complete/reopen/start/stop）。

```bash
curl -s -X PATCH http://localhost:19851/tasks/task_1719400000000_abc12 -H 'Content-Type: application/json' \
  -d '{"title":"新标题","content":"新内容"}'
```

### 删除任务

```bash
curl -s -X DELETE http://localhost:19851/tasks/task_1719400000000_abc12
```

### 标记完成 / 重新打开

```bash
# 标记完成（自动停止计时，记录 completed_at）
curl -s -X POST http://localhost:19851/tasks/task_1719400000000_abc12/complete

# 重新打开（status 回到 pending，completed_at 清空）
curl -s -X POST http://localhost:19851/tasks/task_1719400000000_abc12/reopen
```

## 计时功能

每个任务可以单独计时，用于追踪投入时间。**同一时刻只能有一个任务在计时**——开始新任务会自动停止旧任务。

### 开始计时

```bash
curl -s -X POST http://localhost:19851/tasks/task_1719400000000_abc12/start
```

- 任务 status 变为 `timing`
- 如果之前有别的任务在计时，会先停掉它（累计它的秒数）
- 每秒广播一次 `task-timer-tick` 给客户端（含当前 timing_id 和 elapsed）

### 停止计时

```bash
curl -s -X POST http://localhost:19851/tasks/task_1719400000000_abc12/stop
```

- 累计本次计时秒数到 `elapsed_seconds`
- status 变回 `pending`

> 完成一个 timing 中的任务会自动停止计时；删除 timing 中的任务也会清理计时状态。

## 重排任务

调整任务优先级顺序（在活跃区内移动）。

```bash
# 把第 0 个任务移到第 2 个位置
curl -s -X POST http://localhost:19851/tasks/reorder -H 'Content-Type: application/json' \
  -d '{"from_idx":0,"to_idx":2}'
```

返回重排后的完整列表。`from_idx`/`to_idx` 是基于 `GET /tasks` 返回数组（含已完成）的索引。

## 注意事项

- `id` 在 URL 里需要 `encodeURIComponent`（自定义 id 含特殊字符时）
- 任务持久化在 `~/.cloe/tasks.json`，顺序在 `~/.cloe/task-order.json`，应用重启后自动恢复
- 重启时不会自动恢复 `timing` 状态（计时中的任务会被重置为 `pending`，但 `elapsed_seconds` 保留）——因为关机期间的时间不该计入
- 客户端通过 WebSocket 收到 `task-created`、`task-updated`、`task-deleted`、`task-completed`、`task-reopened`、`task-timing-started`、`task-timing-stopped`、`task-reordered`、`task-timer-tick` 等消息
