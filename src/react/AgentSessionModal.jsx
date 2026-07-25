/**
 * AgentSessionModal — Agent Session 列表模态框
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import './agent-session-modal.css';

const API_BASE = 'http://127.0.0.1:19851';

const STATUS_CONFIG = {
  working:        { label: '运行中',   color: '#4d9eff', pulse: true },
  turn_complete:  { label: '已就绪',   color: '#3dd68c', pulse: false },
  needs_decision: { label: '待确认',   color: '#f5a623', pulse: true },
};

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function SessionCard({ session, onSetTitle, onCancel }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(session.title || '');
  const inputRef = useRef(null);

  const cfg = STATUS_CONFIG[session.status] || STATUS_CONFIG.working;
  const displayName = session.title || session.source_label;

  useEffect(() => {
    setTitleValue(session.title || '');
  }, [session.title]);

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

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); }
  }, [commitTitle]);

  return (
    <div className="as-card">
      <div className={`as-status-dot ${cfg.pulse ? 'as-pulse' : ''}`} style={{ background: cfg.color }} />
      <div className="as-card-body">
        {editingTitle ? (
          <input
            ref={inputRef}
            className="as-title-input"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={handleKeyDown}
            placeholder={session.source_label}
          />
        ) : (
          <div className="as-title-row">
            <span className="as-display-name" onClick={() => setEditingTitle(true)}>
              {displayName}
            </span>
            <span className="as-status-badge" style={{ color: cfg.color }}>{cfg.label}</span>
          </div>
        )}
        <div className="as-meta">
          <span>{session.source_label}</span>
          {session.turn_count > 0 && <span>· {session.turn_count}轮</span>}
          <span>· {formatTime(session.created_at)}</span>
        </div>
      </div>
      <button className="as-cancel-btn" onClick={() => onCancel(session.id)} title="取消监听">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function AgentSessionModal({ visible, sessions, onSetTitle, onCancel, onClose }) {
  const backdropRef = useRef(null);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <div className="as-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="as-modal" onClick={(e) => e.stopPropagation()}>
        <div className="as-modal-header">
          <div className="as-modal-title-row">
            <span>Agent Sessions</span>
            {sessions.length > 0 && <span className="as-count-badge">{sessions.length}</span>}
          </div>
          <button className="as-close-btn" onClick={onClose}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="as-modal-body">
          {sessions.length === 0 ? (
            <div className="as-empty">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <p>当前没有活跃的 Agent Session</p>
            </div>
          ) : (
            sessions.map((s) => (
              <SessionCard key={s.id} session={s} onSetTitle={onSetTitle} onCancel={onCancel} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
