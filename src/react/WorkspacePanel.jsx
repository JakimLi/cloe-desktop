/**
 * WorkspacePanel — Unified panel for Agent Sessions + Tasks.
 *
 * Left-right split layout:
 *   - Left sidebar: Agent Sessions (compact cards, always visible)
 *   - Right main: Tasks (primary work area with full CRUD + timer + reorder)
 *
 * Design: pure black semi-transparent + blur, zero gradients, minimal.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import './workspace-panel.css';

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
  working:        { label: t('运行中', 'Running'),   color: '#4d9eff', pulse: true,  icon: 'spinner' },
  turn_complete:  { label: t('已完成', 'Done'),      color: '#3dd68c', pulse: false, icon: 'check' },
  needs_decision: { label: t('待确认', 'Waiting'),   color: '#f5a623', pulse: true,  icon: 'alert' },
};

function SessionIcon({ icon, color }) {
  if (icon === 'spinner') {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" className="wp-spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (icon === 'check') {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function SessionCard({ session, onSetTitle, onCancel, onAcknowledge }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(session.title || '');
  const inputRef = useRef(null);
  const cfg = SESSION_STATUS[session.status] || SESSION_STATUS.working;
  const displayName = session.title || session.source_label;
  const needsAction = session.status === 'turn_complete' || session.status === 'needs_decision';

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
    <div className={`wp-session-card${needsAction ? ' wp-session-action' : ''}`}>
      <div className="wp-session-status-icon">
        <div className={`wp-session-icon-bg ${cfg.pulse ? 'wp-pulse' : ''}`} style={{ borderColor: cfg.color }}>
          <SessionIcon icon={cfg.icon} color={cfg.color} />
        </div>
      </div>
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
            <div className="wp-session-name" onClick={() => setEditingTitle(true)}>{displayName}</div>
            <div className="wp-session-meta">
              <span className="wp-session-source">{session.source_label}</span>
              {session.turn_count > 0 && <span className="wp-session-dot-sep">·</span>}
              {session.turn_count > 0 && <span>{session.turn_count} {t('轮', 'turns')}</span>}
              <span className="wp-session-dot-sep">·</span>
              <span>{formatTime(session.created_at)}</span>
            </div>
          </>
        )}
      </div>
      <div className="wp-session-badge" style={{ color: cfg.color, background: cfg.color + '14' }}>
        {cfg.label}
      </div>
      <div className="wp-session-btns">
        {needsAction && onAcknowledge && (
          <button className="wp-session-ack" onClick={() => onAcknowledge(session.id)} title={t('知道了', 'Acknowledge')}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
        )}
        <button className="wp-session-cancel" onClick={() => onCancel(session.id)} title={t('取消监听', 'Cancel')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ==================== Task Card ====================

function TaskCard({ task, isTiming, onToggleComplete, onStartStop, onEdit, onDelete }) {
  const isCompleted = task.status === 'completed';

  return (
    <div className={`wp-task-card${isCompleted ? ' completed' : ''}${isTiming ? ' timing' : ''}`}>
      <button
        className={`wp-task-check${isCompleted ? ' checked' : ''}`}
        onClick={() => onToggleComplete(task.id, isCompleted)}
        title={isCompleted ? t('恢复', 'Reopen') : t('完成', 'Complete')}
      >
        {isCompleted && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <div className="wp-task-main" onClick={() => onEdit(task)}>
        <div className="wp-task-title-row">
          <span className="wp-task-title">{task.title}</span>
          {isTiming && (
            <span className="wp-task-timer">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              {formatElapsed(task.elapsed_seconds)}
            </span>
          )}
          {!isTiming && task.elapsed_seconds > 0 && (
            <span className="wp-task-elapsed">{formatElapsed(task.elapsed_seconds)}</span>
          )}
        </div>
        {task.content && <div className="wp-task-preview">{task.content}</div>}
        <div className="wp-task-meta">{formatRelative(task.updated_at)}</div>
      </div>

      <div className="wp-task-actions">
        {!isCompleted && (
          <button
            className={`wp-task-play${isTiming ? ' active' : ''}`}
            onClick={() => onStartStop(task.id, isTiming)}
            title={isTiming ? t('暂停', 'Pause') : t('开始计时', 'Start')}
          >
            {isTiming ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
        )}
        <button className="wp-task-delete" onClick={() => onDelete(task.id)} title={t('删除', 'Delete')}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {isTiming && <div className="wp-task-progress"><div className="wp-task-progress-bar wp-timing-animate" /></div>}
    </div>
  );
}

// ==================== Task Editor ====================

function TaskEditor({ task, onSave, onCancel }) {
  const [title, setTitle] = useState(task.title);
  const [content, setContent] = useState(task.content || '');
  const titleRef = useRef(null);

  useEffect(() => {
    if (titleRef.current) { titleRef.current.focus(); titleRef.current.select(); }
  }, []);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onSave(task.id, { title: trimmedTitle, content: content.trim() });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSave(); }
  };

  return (
    <div className="wp-editor-overlay" onClick={onCancel}>
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

// ==================== Main Panel ====================

export default function WorkspacePanel({
  visible,
  sessions,
  tasks,
  timingId,
  onSessionSetTitle,
  onSessionCancel,
  onSessionAcknowledge,
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

  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  if (!visible) return null;

  const activeSessions = sessions || [];
  const activeTasks = tasks || [];

  return (
    <div className="wp-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="wp-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="wp-header">
          <span className="wp-title">{t('工作区', 'Workspace')}</span>
          <button className="wp-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Body: left sidebar (sessions) + right main (tasks) ── */}
        <div className="wp-body">
          {/* ── Left: Agent Sessions (always visible, empty state when no sessions) ── */}
          <div className="wp-sidebar">
            <div className="wp-sidebar-header">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wp-sidebar-icon">
                <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <span>{t('Agent', 'Agent')}</span>
              <span className="wp-sidebar-count">{activeSessions.length}</span>
            </div>
            <div className="wp-sessions-list">
              {activeSessions.map(s => (
                <SessionCard key={s.id} session={s} onSetTitle={onSessionSetTitle} onCancel={onSessionCancel} onAcknowledge={onSessionAcknowledge} />
              ))}
              {activeSessions.length === 0 && (
                <div className="wp-empty-sessions">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                  <p>{t('暂无 Agent', 'No active agents')}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Divider ── */}
          <div className="wp-divider" />

          {/* ── Right: Tasks ── */}
          <div className="wp-main">
            <div className="wp-main-header">
              <div className="wp-main-header-left">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wp-sidebar-icon">
                  <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span>{t('任务', 'Tasks')}</span>
                <span className="wp-sidebar-count">{activeTasks.length}</span>
              </div>
            </div>

            {/* Add task input */}
            <AddTaskInput onAdd={onTaskCreate} />

            {/* Task list */}
            <div className="wp-task-list">
              {activeTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isTiming={timingId === task.id}
                  onToggleComplete={onTaskToggleComplete}
                  onStartStop={onTaskStartStop}
                  onEdit={(tk) => setEditingTask(tk)}
                  onDelete={onTaskDelete}
                />
              ))}
              {activeTasks.length === 0 && (
                <div className="wp-empty-tasks">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                  <p>{t('暂无任务', 'No tasks yet')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {editingTask && (
        <TaskEditor
          task={editingTask}
          onSave={(id, data) => { onTaskUpdate(id, data); setEditingTask(null); }}
          onCancel={() => setEditingTask(null)}
        />
      )}
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
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        placeholder={t('添加新任务…', 'Add new task…')}
      />
      <button
        className="wp-add-btn"
        onClick={handleAdd}
        disabled={!value.trim()}
        title={t('添加', 'Add')}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
