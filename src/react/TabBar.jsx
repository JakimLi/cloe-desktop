/**
 * TabBar — Inline tab bar embedded in the titlebar.
 *
 * Shows all terminal tabs, supports click-to-switch, double-click-to-rename,
 * hover close button, drag-to-reorder, and a + button to create new tabs.
 * Only rendered in terminal mode.
 *
 * Reorder uses pointer events (NOT HTML5 draggable) because draggable
 * conflicts with Electron's -webkit-app-region: drag on the titlebar.
 *
 * Close confirmation is handled by the parent (App.jsx) via pendingCloseTab,
 * so both the close button and the Cmd+W shortcut share the same flow.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './tab-bar.css';

// Drag threshold in pixels — must move this far before treating as drag (not click)
const DRAG_THRESHOLD = 5;

export default function TabBar({ tabs, activeTabId, onSelect, onCreate, onClose, onRename, onReorder }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  // Pointer-based reorder state
  const [dragState, setDragState] = useState(null);
  // dragState: null | { fromIdx, startX, startY, currentIdx, before: boolean, active: boolean }
  const dragRef = useRef(null);
  const itemRefs = useRef([]);

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

  // ── Pointer-based reorder ──
  // Mouse down on a tab: record position. If mouse moves >threshold, start drag.
  // Mouse move during drag: update indicator. Mouse up: commit or cancel.
  const onPointerDown = useCallback((e, idx) => {
    if (editingId) return;
    // Only left button
    if (e.button !== 0) return;

    dragRef.current = {
      fromIdx: idx,
      startX: e.clientX,
      startY: e.clientY,
      currentIdx: idx,
      before: false,
      active: false,
    };
  }, [editingId]);

  // Global pointermove + pointerup listeners active during potential/drag
  useEffect(() => {
    const onMove = (e) => {
      const ref = dragRef.current;
      if (!ref) return;

      const dx = e.clientX - ref.startX;
      const dy = e.clientY - ref.startY;
      const dist = Math.hypot(dx, dy);

      // Activate drag after threshold
      if (!ref.active && dist > DRAG_THRESHOLD) {
        ref.active = true;
        setDragState({ fromIdx: ref.fromIdx, currentIdx: ref.fromIdx, before: false });
      }

      if (!ref.active) return;

      // Find which tab the pointer is over
      let newIdx = -1;
      let before = false;
      for (let i = 0; i < itemRefs.current.length; i++) {
        const el = itemRefs.current[i];
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          newIdx = i;
          before = e.clientX < rect.left + rect.width / 2;
          break;
        }
      }

      if (newIdx !== -1 && (newIdx !== ref.currentIdx || before !== ref.before)) {
        ref.currentIdx = newIdx;
        ref.before = before;
        setDragState({ fromIdx: ref.fromIdx, currentIdx: newIdx, before });
      }
    };

    const onUp = () => {
      const ref = dragRef.current;
      dragRef.current = null;

      if (ref && ref.active) {
        // Commit reorder
        if (ref.fromIdx !== ref.currentIdx) {
          // Adjust target: if dropping after a tab that's before the source, index is same;
          // if before a tab that's after source, index is same. Let parent handle logic.
          onReorder(ref.fromIdx, ref.currentIdx);
        }
      }
      // If not active, it was a click — handled by onClick

      setDragState(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [onReorder]);

  return (
    <div className="tab-bar">
      <div className="tab-bar-list">
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingId === tab.id;
          const canClose = tabs.length > 1;
          const isDragging = dragState && dragState.fromIdx === idx;
          const isDropBefore = dragState && dragState.active && dragState.currentIdx === idx && dragState.before && dragState.fromIdx !== idx;
          const isDropAfter = dragState && dragState.active && dragState.currentIdx === idx && !dragState.before && dragState.fromIdx !== idx;

          return (
            <div
              key={tab.id}
              ref={(el) => { itemRefs.current[idx] = el; }}
              className={`tab-bar-item${isActive ? ' active' : ''}${isDragging ? ' dragging' : ''}${isDropBefore ? ' drop-before' : ''}${isDropAfter ? ' drop-after' : ''}`}
              onPointerDown={(e) => !isEditing && onPointerDown(e, idx)}
              onClick={() => {
                // Suppress click if this was a drag
                if (dragState && dragState.active) return;
                if (!isEditing) onSelect(tab.id);
              }}
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
