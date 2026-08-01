'use strict';

/**
 * Task Manager — 子 Agent 任务管理系统
 *
 * 主 Agent 通过 spawn_agent 工具创建子 Agent 任务。
 * 子 Agent 在后台独立运行，完成后通过 followUp 机制通知主 Agent。
 *
 * 两种模式:
 *   - sync:  主 Agent 阻塞等待结果（适合短任务）
 *   - async: 主 Agent 继续工作，完成后自动 followUp 通知（适合长任务）
 *
 * 生命周期:
 *   spawn() → running → done/failed/timeout
 *   完成后自动清理（默认 1 小时后回收）
 */

const { AgentSession } = require('./agent');

let taskCounter = 0;
const tasks = new Map(); // taskId → taskInfo

// followUp 触发器（由 native-proxy 注册）
let _followUpTrigger = null;

// 任务超时（毫秒）
const DEFAULT_TIMEOUT = 10 * 60 * 1000; // 10 分钟

/**
 * 注册 followUp 触发器。
 * 当子任务完成时，调用此函数通知主 session。
 * @param {function} fn - (cloeSessionId, taskId, task, result) => void
 */
function setFollowUpTrigger(fn) {
  _followUpTrigger = fn;
}

/**
 * 创建并启动一个子 Agent 任务。
 *
 * @param {string} task - 任务描述
 * @param {object} options
 * @param {string} options.cloeSessionId - 父 session ID（用于 followUp）
 * @param {string} options.mode - "sync" | "async"
 * @param {number} options.timeout - 超时毫秒（默认 10 分钟）
 * @returns {Promise<string>} taskId
 */
async function spawn(task, options = {}) {
  const taskId = `task-${++taskCounter}`;
  const cloeSessionId = options.cloeSessionId || null;
  const mode = options.mode || 'async';
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  const taskInfo = {
    id: taskId,
    status: 'running',
    result: null,
    startedAt: Date.now(),
    completedAt: null,
    toolsUsed: [],
    task,
    cloeSessionId,
    mode,
  };

  tasks.set(taskId, taskInfo);

  // 创建子 Agent（sub-agent 模式：无灵魂文件、无 spawn 工具、无历史）
  const subSession = new AgentSession(`sub-${taskId}`, {
    subAgent: true,
    taskPrompt: task,
  });
  taskInfo.subSession = subSession;

  // 超时定时器
  const timeoutTimer = setTimeout(() => {
    if (taskInfo.status === 'running') {
      try { subSession.abort(); } catch {}
      _finishTask(taskInfo, 'timeout', `任务超时（${Math.floor(timeout / 1000)}秒），已终止`);
    }
  }, timeout);

  // 后台运行子 Agent
  subSession.addUserMessage(task);

  subSession.run({
    onTool: (toolInfo) => {
      taskInfo.toolsUsed.push(toolInfo);
    },
    onEnd: (fullText) => {
      clearTimeout(timeoutTimer);
      _finishTask(taskInfo, 'done', fullText);
    },
    onError: (err) => {
      clearTimeout(timeoutTimer);
      _finishTask(taskInfo, 'failed', `子 Agent 出错: ${err}`);
    },
  }, undefined).catch((e) => {
    clearTimeout(timeoutTimer);
    _finishTask(taskInfo, 'failed', `子 Agent 异常: ${e.message}`);
  });

  return taskId;
}

/**
 * 内部：完成任务并触发 followUp（仅 async 模式）。
 */
function _finishTask(taskInfo, status, result) {
  if (taskInfo.status !== 'running') return; // 防止重复完成

  taskInfo.status = status;
  taskInfo.result = result;
  taskInfo.completedAt = Date.now();

  console.log(`[TaskManager] Task ${taskInfo.id} ${status} (${Math.floor((taskInfo.completedAt - taskInfo.startedAt) / 1000)}s)`);

  // sync 模式不触发 followUp（结果通过 waitForCompletion 直接返回）
  if (taskInfo.mode === 'sync') return;

  // async 模式：触发 followUp 通知主 session
  if (taskInfo.cloeSessionId && _followUpTrigger) {
    const task = taskInfo.task;
    const summary = typeof result === 'string' && result.length > 6000
      ? result.slice(0, 6000) + '\n\n[结果过长，已截断。完整结果可通过 check_task 查看]'
      : result;

    const notification = status === 'done'
      ? `[系统通知] 后台任务 ${taskInfo.id} 已完成。\n任务: ${task}\n\n结果:\n${summary}`
      : `[系统通知] 后台任务 ${taskInfo.id} ${status === 'timeout' ? '超时' : '失败'}。\n任务: ${task}\n${summary}`;

    try {
      _followUpTrigger(taskInfo.cloeSessionId, taskInfo.id, notification);
    } catch (e) {
      console.error(`[TaskManager] followUp trigger failed for ${taskInfo.id}:`, e.message);
    }
  }
}

/**
 * 查询任务状态。
 * @param {string} taskId
 * @returns {object} { status, result, error, toolsUsed, elapsedSeconds, task }
 */
function check(taskId) {
  const task = tasks.get(taskId);
  if (!task) return { status: 'not_found', taskId };

  const elapsed = task.completedAt
    ? Math.floor((task.completedAt - task.startedAt) / 1000)
    : Math.floor((Date.now() - task.startedAt) / 1000);

  const result = {
    taskId: task.id,
    status: task.status,
    task: task.task,
    elapsedSeconds: elapsed,
    toolsUsed: task.toolsUsed.length,
    toolsSummary: task.toolsUsed.slice(-10).map((t) => `${t.emoji || '🔧'} ${t.tool}: ${t.label || ''}`),
  };

  if (task.status === 'done') {
    result.result = task.result;
  } else if (task.status === 'failed' || task.status === 'timeout') {
    result.error = task.result;
  }

  return result;
}

/**
 * 同步等待任务完成（用于 sync 模式）。
 * @param {string} taskId
 * @param {number} timeout - 最大等待毫秒
 * @returns {Promise<string>} 任务结果文本
 */
function waitForCompletion(taskId, timeout = 300000) {
  return new Promise((resolve) => {
    const task = tasks.get(taskId);
    if (!task) { resolve('Task not found'); return; }
    if (task.status !== 'running') { resolve(task.result); return; }

    const deadline = Date.now() + timeout;
    const interval = setInterval(() => {
      const t = tasks.get(taskId);
      if (!t || t.status !== 'running' || Date.now() > deadline) {
        clearInterval(interval);
        resolve(t?.result || 'Timeout waiting for task completion');
      }
    }, 2000);
  });
}

/**
 * 列出所有任务。
 */
function list() {
  return Array.from(tasks.values()).map((t) => ({
    id: t.id,
    status: t.status,
    mode: t.mode,
    task: t.task.slice(0, 100),
    elapsedSeconds: Math.floor((Date.now() - t.startedAt) / 1000),
    toolsUsed: t.toolsUsed.length,
  }));
}

/**
 * 清理旧的已完成任务（定期调用）。
 */
function cleanup(maxAgeMs = 3600000) {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (task.status !== 'running' && task.completedAt && now - task.completedAt > maxAgeMs) {
      tasks.delete(id);
    }
  }
}

// 定期清理（每小时）
setInterval(() => cleanup(), 3600000);

module.exports = {
  spawn,
  check,
  waitForCompletion,
  list,
  cleanup,
  setFollowUpTrigger,
};
