/**
 * TabBar — Inline tab bar embedded in the titlebar.
 *
 * Shows all terminal tabs, supports click-to-switch, double-click-to-rename,
 * hover close button, and a + button to create new tabs.
 * Only rendered in terminal mode.
 */

import React, { useState, useRef, useEffect } from 'react';
import './tab-bar.css';

const isZh = () => navigator.language?.startsWith('zh');
const t = (zh, en) => (isZh() ? zh : en);

export default function TabBar({ tabs, activeTabId, onSelect, onCreate, onClose, onRename }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [confirmTab, setConfirmTab] = useState(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  // Close confirm dialog on outside click or Escape
  useEffect(() => {
    if (!confirmTab) return;
    const onDown = (e) => {
      if (confirmRef.current && !confirmRef.current.contains(e.target)) setConfirmTab(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setConfirmTab(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [confirmTab]);

  const startEdit = (tab) => {
    setEditingId(tab.id);
    setEditValue(tab.title);
  };

  const commitEdit = () => {
    if (editingId) {
      const trimmed = editValue.trim();
      if (trimmed) onRename(editingId, trimmed);
    }
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleClose = (tab) => {
    setConfirmTab(tab);
  };

  const confirmClose = () => {
    if (confirmTab) onClose(confirmTab.id);
    setConfirmTab(null);
  };

  return (
    <div className="tab-bar">
      <div className="tab-bar-list">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingId === tab.id;
          const canClose = tabs.length > 1;

          return (
            <div
              key={tab.id}
              className={`tab-bar-item${isActive ? ' active' : ''}`}
              onClick={() => !isEditing && onSelect(tab.id)}
              onDoubleClick={() => startEdit(tab)}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="tab-bar-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="tab-bar-title">{tab.title}</span>
                  {canClose && (
                    <button
                      className="tab-bar-close"
                      title="Close tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClose(tab);
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {tabs.length < 10 && (
        <button className="tab-bar-add" title="New tab" onClick={onCreate}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      )}

      {/* Close confirmation dialog */}
      {confirmTab && (
        <div className="tab-bar-confirm-overlay" onClick={(e) => e.stopPropagation()}>
          <div className="tab-bar-confirm" ref={confirmRef} onClick={(e) => e.stopPropagation()}>
            <div className="tab-bar-confirm-text">
              {t(`关闭标签页「${confirmTab.title}」？`, `Close tab "${confirmTab.title}"?`)}
            </div>
            <div className="tab-bar-confirm-actions">
              <button
                className="tab-bar-confirm-btn tab-bar-confirm-cancel"
                onClick={() => setConfirmTab(null)}
              >
                {t('取消', 'Cancel')}
              </button>
              <button
                className="tab-bar-confirm-btn tab-bar-confirm-ok"
                onClick={confirmClose}
              >
                {t('关闭', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
