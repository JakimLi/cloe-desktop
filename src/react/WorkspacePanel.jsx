/**
 * WorkspacePanel — Unified panel for Agent Sessions + Tasks.
 *
 * Replaces AgentSessionModal. Two sections stacked vertically:
 *   - Agent Sessions (top, collapsible, auto-hides when empty)
 *   - Tasks (bottom, primary section with full CRUD + timer + drag reorder)
 *
 * Design: pure black semi-transparent + blur, zero gradients, minimal.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import './workspace-panel.css';

const API_BASE = 'http://127.0.0.1:19851';

// ==================== i18n ====================

const isZh = () => {
  const saved = localStorage.getItem('cloe-manager-lang');
  if (saved) return saved.startsWith('zh');
  return navigator.language?.startsWith('zh');
};
const t = (zh, en) => (isZh() ? zh : en);

// ==================== Formatters ====================

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatElapsed(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatRelative(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('刚刚', 'just now');
  if (mins < 60) return t(`${mins}分钟前`, `${mins}m ago`);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t(`${hours}小时前`, `${hours}h ago`);
  const days = Math.floor(hours / 24);
  return t(`${days}天前`, `${days}d ago`);
}

// ==================== Agent Session Card ====================

const SESSION_STATUS = {
  working:        { label: t('运行中', 'Working'),   color: '#4d9eff', pulse: true },
  turn_complete:  { label: t('已完成', 'Done'),      color: '#3dd68c', pulse: false },
  needs_decision: { label: t('待确认', 'Waiting'),   color: '#f5a623', pulse: true },
};

function SessionCard({ session, onSetTitle, onCancel }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(session.title || '');
  const inputRef = useRef(null);
  const cfg = SESSION_STATUS[session.status] || SESSION_STATUS.working;
  const displayName = session.title || session.source_label;

  useEffect(() => { setTitleValue(session.title || ''); }, [session.title]);
  useEffect(() => {
    if (editingTitle && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTitle]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed !== (session.title || '')) onSetTitle(session.id, trimmed);
  }, [titleValue, session.id, session.title, onSetTitle]);

  return (
    <div className="wp-session-card">
      <div className={`wp-session-dot ${cfg.pulse ? 'wp-pulse' : ''}`} style={{ background: cfg.color }} />
      <div className="wp-session-body">
        {editingTitle ? (
          <input
            ref={inputRef}
            className="wp-inline-input"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
              else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); }
            }}
            placeholder={session.source_label}
          />
        ) : (
          <>
            <div className="wp-session-title-row">
              <span className="wp-session-name" onClick={() => setEditingTitle(true)}>{displayName}</span>
              <span className="wp-session-badge" style={{ color: cfg.color }}>{cfg.label}</span>
            </div>
            <div className="wp-session-meta">
              <span>{session.source_label}</span>
              {session.turn_count > 0 && <span>· {session.turn_count}{t('轮', ' turns')}</span>}
              <span>· {formatTime(session.created_at)}</span>
            </div>
          </>
        )}
      </div>
      <button className="wp-session-cancel" onClick={() => onCancel(session.id)} title={t('取消监听', 'Cancel')}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ==================== Task Card ====================

function TaskCard({ task, isTiming, onToggleComplete, onStartStop, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = task.status === 'completed';

  // Drag handlers (reorder)
  const onDragStart = (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task._idx));
    requestAnimationFrame(() => e.target.classList.add('wp-task-dragging'));
  };
  const onDragEnd = (e) => {
    e.target.classList.remove('wp-task-dragging');
    document.querySelectorAll('.wp-task-drop-before, .wp-task-drop-after')
      .forEach(el => el.classList.remove('wp-task-drop-before', 'wp-task-drop-after'));
  };
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.wp-task-drop-before, .wp-task-drop-after')
      .forEach(el => el.classList.remove('wp-task-drop-before', 'wp-task-drop-after'));
    const card = e.target.closest('.wp-task-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.classList.add(e.clientY < rect.top + rect.height / 2 ? 'wp-task-drop-before' : 'wp-task-drop-after');
  };
  const onDrop = (e) => {
    e.preventDefault();
    document.querySelectorAll('.wp-task-drop-before, .wp-task-drop-after')
      .forEach(el => el.classList.remove('wp-task-drop-before', 'wp-task-drop-after'));
    // handled by parent
  };

  return (
    <div
      className={`wp-task-card ${isCompleted ? ' completed' : ''} ${isTiming ? ' timing' : ''}`}
      draggable={!isCompleted}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-idx={task._idx}
    >
      {/* Drag handle */}
      <div className="wp-task-handle">
        <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" opacity="0.2">
          <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
          <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
          <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
        </svg>
      </div>

      {/* Completion checkbox */}
      <button
        className={`wp-task-check ${isCompleted ? ' checked' : ''}`}
        onClick={() => onToggleComplete(task.id, isCompleted)}
        title={isCompleted ? t('恢复', 'Reopen') : t('完成', 'Complete')}
      >
        {isCompleted && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {/* Main content */}
      <div className="wp-task-main" onClick={() => onEdit(task)}>
        <div className="wp-task-title-row">
          <span className="wp-task-title">{task.title}</span>
          {isTiming && (
            <span className="wp-task-timer">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {formatElapsed(task.elapsed_seconds)}
            </span>
          )}
          {!isTiming && task.elapsed_seconds > 0 && (
            <span className="wp-task-elapsed">{formatElapsed(task.elapsed_seconds)}</span>
          )}
        </div>
        {/* Content preview (truncated) */}
        {task.content && !expanded && (
          <div className="wp-task-preview">{task.content}</div>
        )}
        <div className="wp-task-meta">
          <span>{formatRelative(task.updated_at)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="wp-task-actions">
        {!isCompleted && (
          <button
            className={`wp-task-play ${isTiming ? ' active' : ''}`}
            onClick={() => onStartStop(task.id, isTiming)}
            title={isTiming ? t('暂停', 'Pause') : t('开始计时', 'Start')}
          >
            {isTiming ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
        )}
        <button className="wp-task-delete" onClick={() => onDelete(task.id)} title={t('删除', 'Delete')}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Timing progress bar */}
      {isTiming && (
        <div className="wp-task-progress">
          <div className="wp-task-progress-bar wp-timing-animate" />
        </div>
      )}
    </div>
  );
}

// ==================== Task Editor ====================

function TaskEditor({ task, onSave, onCancel }) {
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content || '');
  const titleRef = useRef(null);

  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, []);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onSave(task.id, { title: trimmedTitle, content: content.trim() });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    // Cmd/Ctrl+Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); }
  };

  return (
    <div className="wp-editor-overlay">
      <div className="wp-editor" onClick={(e) => e.stopPropagation()}>
        <input
          ref={titleRef}
          className="wp-editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('任务标题', 'Task title')}
        />
        <textarea
          className="wp-editor-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('详细内容（可选）', 'Details (optional)')}
          rows={6}
        />
        <div className="wp-editor-actions">
          <button className="wp-editor-cancel" onClick={onCancel}>{t('取消', 'Cancel')}</button>
          <button className="wp-editor-save" onClick={handleSave}>{t('保存', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}

// ==================== Add Task Input ====================

function AddTaskInput({ onAdd }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const handleAdd = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue('');
    if (inputRef.current) inputRef.current.focus();
  };

  return (
    <div className="wp-add-task">
      <input
        ref={inputRef}
        className="wp-add-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
        }}
        placeholder={t('添加新任务...', 'Add new task...')}
      />
      <button
        className="wp-add-btn"
        onClick={handleAdd}
        disabled={!value.trim()}
        title={t('添加任务', 'Add task')}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ==================== Main Panel ====================

export default function WorkspacePanel({
  visible,
  sessions,
  tasks,
  timingId,
  onSessionSetTitle,
  onSessionCancel,
  onTaskCreate,
  onTaskUpdate,
  onTaskDelete,
  onTaskToggleComplete,
  onTaskStartStop,
  onTaskReorder,
  onClose,
}) {
  const backdropRef = useRef(null);
  const [editingTask, setEditingTask] = useState(null);

  // Track drag state for reorder
  const dragRef = useRef({ dragging: false, fromIdx: -1 });
  const listRef = useRef(null);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  // Drag-to-reorder handler on the task list container
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    document.querySelectorAll('.wp-task-dragging, .wp-task-drop-before, .wp-task-drop-after')
      .forEach(el => el.classList.remove('wp-task-dragging', 'wp-task-drop-before', 'wp-task-drop-after'));
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;

    const toCard = e.target.closest('.wp-task-card');
    if (!toCard) return;
    const toIdx = parseInt(toCard.dataset.idx, 10);
    const fromIdx = dragRef.current.fromIdx;
    if (fromIdx !== toIdx && !isNaN(fromIdx) && !isNaN(toIdx)) {
      onTaskReorder(fromIdx, toIdx);
    }
  }, [onTaskReorder]);

  if (!visible) return null;

  const activeSessions = sessions;
  const activeTasks = tasks || [];

  return (
    <div className="wp-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="wp-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="wp-header">
          <span className="wp-title">{t('工作区', 'Workspace')}</span>
          <button className="wp-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Agent Sessions Section */}
        {activeSessions.length > 0 && (
          <div className="wp-section wp-sessions-section">
            <div className="wp-section-header">
              <span className="wp-section-label">{t('Agent Sessions', 'Agent Sessions')}</span>
              <span className="wp-section-count">{activeSessions.length}</span>
            </div>
            <div className="wp-sessions-list">
              {activeSessions.map(s => (
                <SessionCard key={s.id} session={s} onSetTitle={onSessionSetTitle} onCancel={onSessionCancel} />
              ))}
            </div>
          </div>
        )}

        {/* Tasks Section */}
        <div className="wp-section wp-tasks-section">
          <div className="wp-section-header">
            <span className="wp-section-label">{t('任务', 'Tasks')}</span>
            <span className="wp-section-count">{activeTasks.length}</span>
          </div>

          {/* Add task */}
          <AddTaskInput onAdd={onTaskCreate} />

          {/* Task list */}
          <div
            className="wp-task-list"
            ref={listRef}
            onDragOver={(e) => {
              if (!dragRef.current.dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={handleDrop}
          >
            {activeTasks.map((task, idx) => (
              <TaskCard
                key={task.id}
                task={{ ...task, _idx: idx }}
                isTiming={timingId === task.id}
                onToggleComplete={onTaskToggleComplete}
                onStartStop={onTaskStartStop}
                onEdit={(t) => setEditingTask(t)}
                onDelete={onTaskDelete}
              />
            ))}
            {activeTasks.length === 0 && (
              <div className="wp-empty-tasks">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <p>{t('暂无任务', 'No tasks yet')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Task editor overlay */}
      {editingTask && (
        <TaskEditor
          task={editingTask}
          onSave={(id, data) => {
            onTaskUpdate(id, data);
            setEditingTask(null);
          }}
          onCancel={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
