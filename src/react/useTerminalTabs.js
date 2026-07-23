/**
 * useTerminalTabs — Terminal multi-tab state management.
 *
 * Manages tab lifecycle (create/close/switch) and coordinates PTY resources
 * with the main process. PTY spawn/kill is handled here; xterm instance
 * lifecycle is delegated to TerminalMode.
 */

import { useState, useCallback } from 'react';

const MAX_TABS = 10;
let _counter = 0;

export function useTerminalTabs() {
  const [tabs, setTabs] = useState([{ id: 'default', title: 'zsh' }]);
  const [activeTabId, setActiveTabId] = useState('default');

  /** Create a new tab and activate it. No-op if at capacity. */
  const createTab = useCallback(() => {
    setTabs(prev => {
      if (prev.length >= MAX_TABS) return prev;
      const id = 'tab-' + (++_counter);
      setActiveTabId(id);
      return [...prev, { id, title: 'zsh' }];
    });
  }, []);

  /** Close a tab, kill its PTY, and switch to an adjacent tab. */
  const closeTab = useCallback((tabId) => {
    if (tabs.length <= 1) return;

    let newActiveId = activeTabId;
    if (tabId === activeTabId) {
      const idx = tabs.findIndex(t => t.id === tabId);
      const remaining = tabs.filter(t => t.id !== tabId);
      const newIdx = Math.min(idx, remaining.length - 1);
      newActiveId = remaining[newIdx].id;
    }

    window.electronAPI?.ptyKill?.(tabId);
    setTabs(tabs.filter(t => t.id !== tabId));
    if (tabId === activeTabId) setActiveTabId(newActiveId);
  }, [tabs, activeTabId]);

  /** Update a tab's display title (from OSC escape sequence). */
  const updateTabTitle = useCallback((tabId, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, title: trimmed } : t));
  }, []);

  /** Switch to the next tab (circular). */
  const nextTab = useCallback(() => {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx === -1 || tabs.length <= 1) return;
    setActiveTabId(tabs[(idx + 1) % tabs.length].id);
  }, [tabs, activeTabId]);

  /** Switch to the previous tab (circular). */
  const prevTab = useCallback(() => {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx === -1 || tabs.length <= 1) return;
    setActiveTabId(tabs[(idx - 1 + tabs.length) % tabs.length].id);
  }, [tabs, activeTabId]);

  /** Reorder a tab from one position to another (drag-and-drop). */
  const reorderTab = useCallback((fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    setTabs(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    createTab,
    closeTab,
    updateTabTitle,
    nextTab,
    prevTab,
    reorderTab,
  };
}
