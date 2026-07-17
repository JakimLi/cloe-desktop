/**
 * TabBar — Inline tab bar embedded in the titlebar.
 *
 * Shows all terminal tabs, supports click-to-switch, double-click-to-rename,
 * hover close button, and a + button to create new tabs.
 * Only rendered in terminal mode.
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
