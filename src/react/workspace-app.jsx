/**
 * workspace-app.jsx — Entry point for the standalone Workspace Window.
 *
 * Renders WorkspacePanel as a full-window component (no overlay/backdrop).
 * Connects directly to the Cloe API + WS for sessions, tasks, reminders.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspacePanel from './WorkspacePanel';

const API_BASE = 'http://127.0.0.1:19851';
const WS_URL = 'ws://127.0.0.1:19850';

function WorkspaceApp() {
  // ── Agent Sessions ──
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/agent-sessions`)
      .then(r => r.json())
      .then(data => { if (data.sessions) setSessions(data.sessions); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (!msg || !msg.type) return;
      if (msg.type.startsWith('agent-session-')) {
        if (msg.type === 'agent-session-list' && msg.sessions) {
          setSessions(msg.sessions);
        } else if (msg.session) {
          setSessions(prev => {
            const idx = prev.findIndex(s => s.id === msg.session.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = msg.session; return next; }
            return [...prev, msg.session];
          });
        } else if (msg.type === 'agent-session-removed' && msg.id) {
          setSessions(prev => prev.filter(s => s.id !== msg.id));
        }
      }
    };
    window.addEventListener('cloe-agent-session', handler);
    return () => window.removeEventListener('cloe-agent-session', handler);
  }, []);

  // ── Reminders ──
  const [reminders, setReminders] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/reminders`)
      .then(r => r.json())
      .then(data => { if (data.reminders) setReminders(data.reminders); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (!msg || !msg.type) return;
      if (msg.type.startsWith('reminder-')) {
        if (msg.reminder) {
          setReminders(prev => {
            const idx = prev.findIndex(r => r.id === msg.reminder.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = msg.reminder; return next; }
            return [...prev, msg.reminder];
          });
        } else if (msg.type === 'reminder-deleted' && msg.id) {
          setReminders(prev => prev.filter(r => r.id !== msg.id));
        }
      }
    };
    window.addEventListener('cloe-reminder', handler);
    return () => window.removeEventListener('cloe-reminder', handler);
  }, []);

  // ── Tasks ──
  const [tasks, setTasks] = useState([]);
  const [timingId, setTimingId] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/tasks`)
      .then(r => r.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks);
        if (data.timing_id !== undefined) setTimingId(data.timing_id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const msg = e.detail;
      if (!msg || !msg.type) return;

      if (msg.type === 'task-state-sync') {
        setTasks(msg.tasks || []);
        setTimingId(msg.timing_id || null);
        return;
      }
      if (msg.type === 'task-timer-tick') {
        setTasks(prev => prev.map(t =>
          t.id === msg.task_id ? { ...t, elapsed_seconds: msg.elapsed_seconds } : t
        ));
        return;
      }
      if (msg.type === 'task-created' || msg.type === 'task-updated' ||
          msg.type === 'task-completed' || msg.type === 'task-reopened' ||
          msg.type === 'task-timing-started' || msg.type === 'task-timing-stopped') {
        if (msg.task) {
          setTasks(prev => {
            const idx = prev.findIndex(t => t.id === msg.task.id);
            if (idx >= 0) { const next = [...prev]; next[idx] = msg.task; return next; }
            return [...prev, msg.task];
          });
        }
        if (msg.type === 'task-timing-started') setTimingId(msg.task?.id || null);
        if (msg.type === 'task-timing-stopped') setTimingId(null);
        return;
      }
      if (msg.type === 'task-deleted') {
        if (msg.task_id) setTasks(prev => prev.filter(t => t.id !== msg.task_id));
        return;
      }
    };
    window.addEventListener('cloe-task', handler);
    return () => window.removeEventListener('cloe-task', handler);
  }, []);

  // ── Agent callbacks ──
  const handleAgentSetTitle = useCallback((id, title) => {
    fetch(`${API_BASE}/agent-sessions/${encodeURIComponent(id)}/title`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const handleAgentCancel = useCallback((id) => {
    fetch(`${API_BASE}/agent-sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }, []);

  // ── Internal session callbacks (Cloe Desktop chat sessions) ──
  const handleSessionCreate = useCallback(() => {
    if (window.electronAPI?.createChatSession) {
      window.electronAPI.createChatSession();
    } else {
      // Fallback: create via API + open window manually
      fetch(`${API_BASE}/agent-sessions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'cloe-desktop', title: 'New chat' }),
      }).then(r => r.json()).then(d => {
        if (d.session) setSessions(prev => [...prev, d.session]);
      }).catch(() => {});
    }
  }, []);

  const handleSessionOpen = useCallback((sessionId) => {
    if (window.electronAPI?.openChatSession) {
      window.electronAPI.openChatSession(sessionId);
    }
  }, []);

  const handleSessionDelete = useCallback((sessionId) => {
    if (window.electronAPI?.deleteChatSession) {
      window.electronAPI.deleteChatSession(sessionId);
    } else {
      fetch(`${API_BASE}/agent-sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
    // Optimistic update
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  }, []);

  // ── Reminder callbacks ──
  const handleReminderCreate = useCallback((data) => {
    fetch(`${API_BASE}/reminders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(r => r.json()).then(d => {
      if (d.reminder) setReminders(prev => {
        const idx = prev.findIndex(r => r.id === d.reminder.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = d.reminder; return next; }
        return [...prev, d.reminder];
      });
    }).catch(() => {});
  }, []);

  const handleReminderToggle = useCallback((id) => {
    fetch(`${API_BASE}/reminders/${encodeURIComponent(id)}/toggle`, { method: 'POST' })
      .then(r => r.json()).then(d => {
        if (d.reminder) setReminders(prev => {
          const idx = prev.findIndex(r => r.id === d.reminder.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = d.reminder; return next; }
          return [...prev, d.reminder];
        });
      }).catch(() => {});
  }, []);

  const handleReminderPauseResume = useCallback((id, action) => {
    fetch(`${API_BASE}/reminders/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      .then(r => r.json()).then(d => {
        if (d.reminder) setReminders(prev => {
          const idx = prev.findIndex(r => r.id === d.reminder.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = d.reminder; return next; }
          return [...prev, d.reminder];
        });
      }).catch(() => {});
  }, []);

  const handleReminderDismiss = useCallback((id) => {
    fetch(`${API_BASE}/tts-scheduler/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceKey: 'reminder:' + id }),
    }).catch(() => {});
    fetch(`${API_BASE}/reminders/${encodeURIComponent(id)}/dismiss`, { method: 'POST' })
      .then(r => r.json()).then(d => {
        if (d.reminder) setReminders(prev => {
          const idx = prev.findIndex(r => r.id === d.reminder.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = d.reminder; return next; }
          return [...prev, d.reminder];
        });
      }).catch(() => {});
  }, []);

  const handleReminderDelete = useCallback((id) => {
    fetch(`${API_BASE}/reminders/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .then(() => setReminders(prev => prev.filter(r => r.id !== id)))
      .catch(() => {});
  }, []);

  // ── Task callbacks ──
  const handleTaskCreate = useCallback((title) => {
    fetch(`${API_BASE}/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }, []);

  const handleTaskUpdate = useCallback((id, data) => {
    fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});
  }, []);

  const handleTaskDelete = useCallback((id) => {
    fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
      .catch(() => {});
  }, []);

  const handleTaskToggleComplete = useCallback((id, isCompleted) => {
    const action = isCompleted ? 'reopen' : 'complete';
    fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      .catch(() => {});
  }, []);

  const handleTaskStartStop = useCallback((id, isTiming) => {
    const action = isTiming ? 'stop' : 'start';
    fetch(`${API_BASE}/tasks/${encodeURIComponent(id)}/${action}`, { method: 'POST' })
      .catch(() => {});
  }, []);

  const handleTaskReorder = useCallback((fromIdx, toIdx) => {
    fetch(`${API_BASE}/tasks/reorder`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_idx: fromIdx, to_idx: toIdx }),
    }).catch(() => {});
  }, []);

  const handleClose = useCallback(() => {
    if (window.electronAPI?.closeWindow) {
      window.electronAPI.closeWindow();
    }
  }, []);

  // ── ESC to close ──
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [handleClose]);

  // ── Shortcut to toggle (same as main window) ──
  useEffect(() => {
    // Import the shortcut matcher inline
    const stored = localStorage.getItem('cloe-agent-tracker-shortcut') || '';
    if (!stored) return;

    const handler = (e) => {
      // Parse shortcut: e.g. "Ctrl+Shift+Space"
      const parts = stored.split('+').map(s => s.trim().toLowerCase());
      const needCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('meta');
      const needShift = parts.includes('shift');
      const needAlt = parts.includes('alt');
      const key = parts.find(p => !['ctrl','cmd','meta','shift','alt'].includes(p));

      const ctrlOK = needCtrl ? (e.metaKey || e.ctrlKey) : true;
      const shiftOK = needShift ? e.shiftKey : true;
      const altOK = needAlt ? e.altKey : true;
      const keyOK = key ? e.key.toLowerCase() === key : false;

      if (ctrlOK && shiftOK && altOK && keyOK) {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [handleClose]);

  // ── Window dragging via pointer events on tab rail ──
  const dragState = useRef(null);

  useEffect(() => {
    // Poll until the tab rail is rendered
    let tabRail = null;
    let pollTimer = null;
    let listeners = [];

    function attachDrag(el) {
      const onPointerDown = (e) => {
        if (e.target.closest('button')) return;
        dragState.current = { startX: e.screenX, startY: e.screenY };
        el.setPointerCapture(e.pointerId);
      };
      const onPointerMove = (e) => {
        if (!dragState.current) return;
        const dx = e.screenX - dragState.current.startX;
        const dy = e.screenY - dragState.current.startY;
        if (dx === 0 && dy === 0) return;
        dragState.current.startX = e.screenX;
        dragState.current.startY = e.screenY;
        if (window.electronAPI?.moveWindow) {
          window.electronAPI.moveWindow(dx, dy);
        }
      };
      const onPointerUp = (e) => {
        dragState.current = null;
        try { el.releasePointerCapture(e.pointerId); } catch {}
      };

      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerUp);
      listeners = [{ el, fns: [onPointerDown, onPointerMove, onPointerUp] }];
    }

    function tryAttach() {
      tabRail = document.querySelector('.wp-tab-rail');
      if (tabRail) {
        attachDrag(tabRail);
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
    }

    tryAttach();
    if (!listeners.length) {
      pollTimer = setInterval(tryAttach, 100);
      // Safety: stop polling after 5s
      setTimeout(() => { if (pollTimer) clearInterval(pollTimer); }, 5000);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
      listeners.forEach(({ el, fns }) => {
        el.removeEventListener('pointerdown', fns[0]);
        el.removeEventListener('pointermove', fns[1]);
        el.removeEventListener('pointerup', fns[2]);
        el.removeEventListener('pointercancel', fns[2]);
      });
    };
  }, []);

  return (
    <WorkspacePanel
      visible={true}
      sessions={sessions}
      tasks={tasks}
      reminders={reminders}
      timingId={timingId}
      onSessionSetTitle={handleAgentSetTitle}
      onSessionCancel={handleAgentCancel}
      onSessionOpen={handleSessionOpen}
      onSessionDelete={handleSessionDelete}
      onSessionCreate={handleSessionCreate}
      onTaskCreate={handleTaskCreate}
      onTaskUpdate={handleTaskUpdate}
      onTaskDelete={handleTaskDelete}
      onTaskToggleComplete={handleTaskToggleComplete}
      onTaskStartStop={handleTaskStartStop}
      onTaskReorder={handleTaskReorder}
      onReminderCreate={handleReminderCreate}
      onReminderToggle={handleReminderToggle}
      onReminderPauseResume={handleReminderPauseResume}
      onReminderDismiss={handleReminderDismiss}
      onReminderDelete={handleReminderDelete}
      onClose={handleClose}
    />
  );
}

// ── WS connection for live updates ──
function connectWS() {
  let ws;
  let reconnectTimer;
  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (!msg || !msg.type) return;
        if (msg.type.startsWith('agent-session-')) {
          window.dispatchEvent(new CustomEvent('cloe-agent-session', { detail: msg }));
        }
        if (msg.type.startsWith('reminder-')) {
          window.dispatchEvent(new CustomEvent('cloe-reminder', { detail: msg }));
        }
        if (msg.type.startsWith('task-')) {
          window.dispatchEvent(new CustomEvent('cloe-task', { detail: msg }));
        }
      } catch {}
    };
    ws.onclose = () => {
      reconnectTimer = setTimeout(connect, 3000);
    };
  }
  connect();
}

connectWS();

const root = createRoot(document.getElementById('root'));
root.render(<WorkspaceApp />);
