/**
 * TabBar — Inline tab bar embedded in the titlebar.
 *
 * Shows all terminal tabs, supports click-to-switch, double-click-to-rename,
 * hover close button, and a + button to create new tabs.
 * Only rendered in terminal mode.
 *
 * Close confirmation is handled by the parent (App.jsx) via pendingCloseTab,
 * so both the close button and the Cmd+W shortcut share the same flow.
 */

import React, { useState, useRef, useEffect } from 'react';
import './tab-bar.css';

export default function TabBar({ tabs, activeTabId, onSelect, onCreate, onClose, onRename }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

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
                        onClose(tab.id);
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
    </div>
  );
}

/**
 * TabCloseConfirm — Confirmation dialog rendered by parent.
 * Exported so App.jsx can use it without duplicating markup.
 */
const isZh = () => {
  const saved = localStorage.getItem('cloe-manager-lang');
  if (saved) return saved.startsWith('zh');
  return navigator.language?.startsWith('zh');
};

export function TabCloseConfirm({ tab, onConfirm, onCancel }) {
  if (!tab) return null;
  const zh = isZh();
  return (
    <div className="tab-bar-confirm-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="tab-bar-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="tab-bar-confirm-text">
          {zh ? `关闭标签页「${tab.title}」？` : `Close tab "${tab.title}"?`}
        </div>
        <div className="tab-bar-confirm-actions">
          <button
            className="tab-bar-confirm-btn tab-bar-confirm-cancel"
            onClick={onCancel}
          >
            {zh ? '取消' : 'Cancel'}
          </button>
          <button
            className="tab-bar-confirm-btn tab-bar-confirm-ok"
            onClick={onConfirm}
          >
            {zh ? '关闭' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
