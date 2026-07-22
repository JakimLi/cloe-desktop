/**
 * AgentSessionModal — Agent Session 列表模态框
 *
 * 显示当前所有活跃的 agent session，支持修改标题和取消监听。
 * 由 App.jsx 通过快捷键控制显示/隐藏。
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import './agent-session-modal.css';

const API_BASE = 'http://127.0.0.1:19851';

const STATUS_CONFIG = {
  working: { label: 'Working', color: '#42a5f5', pulse: true },
  turn_complete: { label: 'Turn Done', color: '#66bb6a', pulse: false },
  needs_decision: { label: 'Needs You', color: '#ffa726', pulse: true },
};

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function SessionCard({ session, onSetTitle, onCancel }) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(session.title || '');
  const inputRef = useRef(null);

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
    if (trimmed !== (session.title || '')) {
      onSetTitle(session.id, trimmed);
    }
  }, [titleValue, session.id, session.title, onSetTitle]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); setTitleValue(session.title || ''); }
  }, [commitTitle, session.title]);

  const cfg = STATUS_CONFIG[session.status] || STATUS_CONFIG.working;

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
            <span
              className="as-display-name"
              onClick={() => setEditingTitle(true)}
              title={session.source}
            >
              {displayName}
            </span>
            <span className="as-status-badge" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
        )}
        <div className="as-meta">
          <span>{session.source_label}</span>
          {session.turn_count > 0 && <span>· {session.turn_count} turns</span>}
          <span>· {formatTime(session.created_at)}</span>
        </div>
      </div>
      <button
        className="as-cancel-btn"
        onClick={() => onCancel(session.id)}
        title="取消监听"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export default function AgentSessionModal({ visible, sessions, onSetTitle, onCancel, onClose }) {
  const backdropRef = useRef(null);

  // Click backdrop to close
  const handleBackdropClick = useCallback((e) => {
    if (e.target === backdropRef.current) onClose();
  }, [onClose]);

  if (!visible) return null;

  return (
    <div className="as-backdrop" ref={backdropRef} onClick={handleBackdropClick}>
      <div className="as-modal" onClick={(e) => e.stopPropagation()}>
        <div className="as-modal-header">
          <div className="as-modal-title-row">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Agent Sessions</span>
          </div>
          <button className="as-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="as-modal-body">
          {sessions.length === 0 ? (
            <div className="as-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 15h8" /><path d="M9 9h.01" /><path d="M15 9h.01" />
              </svg>
              <p>当前没有活跃的 Agent Session</p>
            </div>
          ) : (
            sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                onSetTitle={onSetTitle}
                onCancel={onCancel}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}