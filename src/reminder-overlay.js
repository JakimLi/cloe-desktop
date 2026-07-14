// ==================== Cloe Desktop — Reminder Overlay ====================
// Manages the reminder card UI that appears below the character.
// Listens for WebSocket messages from the bridge (reminder-triggered, etc.)
// and provides keyboard shortcut support for dismiss/stop.
//
// This module is loaded by renderer.js after WebSocket setup.

(function ReminderOverlay() {
  'use strict';

  // ==================== DOM ====================

  const container = document.getElementById('reminder-overlay');
  if (!container) {
    console.warn('[Reminder] #reminder-overlay not found');
    return;
  }

  // ==================== State ====================

  /** Currently triggered reminders (id → reminder data) */
  const active = new Map();

  // ==================== Card Rendering ====================

  /**
   * Build a reminder card element from reminder data.
   */
  function createCard(reminder) {
    const card = document.createElement('div');
    card.className = 'reminder-card';
    card.dataset.id = reminder.id;

    // Icon based on mode
    const icon = reminder.mode === 'countdown' ? '🍅' : '💧';

    // Round info for countdown mode
    const roundInfo = reminder.total_rounds > 0
      ? `${reminder.round || 0}/${reminder.total_rounds}`
      : '';

    card.innerHTML = `
      <div class="reminder-card-icon">${icon}</div>
      <div class="reminder-card-body">
        <div class="reminder-card-title">${escapeHtml(reminder.name)}</div>
        <div class="reminder-card-meta">${formatDuration(reminder.duration)}${roundInfo ? ' · ' + roundInfo : ''}</div>
      </div>
      <div class="reminder-card-actions">
        <button class="reminder-btn reminder-btn-dismiss" data-id="${reminder.id}" title="知道了">✓</button>
        <button class="reminder-btn reminder-btn-stop" data-id="${reminder.id}" title="关闭提醒">✕</button>
      </div>
    `;

    return card;
  }

  function renderCards() {
    container.innerHTML = '';
    for (const [, reminder] of active) {
      container.appendChild(createCard(reminder));
    }
    container.classList.toggle('has-reminders', active.size > 0);
  }

  // ==================== Event Handlers ====================

  container.addEventListener('click', (e) => {
    const dismissBtn = e.target.closest('.reminder-btn-dismiss');
    const stopBtn = e.target.closest('.reminder-btn-stop');

    if (dismissBtn) {
      const id = dismissBtn.dataset.id;
      dismissReminder(id);
      return;
    }

    if (stopBtn) {
      const id = stopBtn.dataset.id;
      stopReminder(id);
      return;
    }
  });

  // ==================== API Calls ====================

  function dismissReminder(id) {
    fetch('http://127.0.0.1:19851/reminders/' + encodeURIComponent(id) + '/dismiss', {
      method: 'POST',
    }).catch((e) => console.error('[Reminder] dismiss failed:', e));
  }

  function stopReminder(id) {
    fetch('http://127.0.0.1:19851/reminders/' + encodeURIComponent(id) + '/stop', {
      method: 'POST',
    }).catch((e) => console.error('[Reminder] stop failed:', e));
  }

  // ==================== WebSocket Message Handler ====================

  /**
   * Called by renderer.js for each WS message. Returns true if handled.
   */
  ReminderOverlay.handleMessage = function (msg) {
    if (!msg || typeof msg !== 'object') return false;

    switch (msg.type) {
      case 'reminder-triggered':
        if (msg.reminder) {
          active.set(msg.reminder.id, msg.reminder);
          renderCards();
        }
        return true;

      case 'reminder-dismissed':
      case 'reminder-stopped':
      case 'reminder-deleted':
        if (msg.reminder && active.has(msg.reminder.id)) {
          active.delete(msg.reminder.id);
          renderCards();
        } else if (msg.id && active.has(msg.id)) {
          active.delete(msg.id);
          renderCards();
        }
        return true;

      default:
        return false;
    }
  };

  // ==================== Keyboard Shortcut Helpers ====================

  /**
   * Dismiss the first active (triggered) reminder.
   * For use with keyboard shortcuts in App.jsx.
   */
  ReminderOverlay.dismissActive = function () {
    for (const [id] of active) {
      dismissReminder(id);
      return true;
    }
    return false;
  };

  /**
   * Stop the first active (triggered) reminder entirely.
   */
  ReminderOverlay.stopActive = function () {
    for (const [id] of active) {
      stopReminder(id);
      return true;
    }
    return false;
  };

  /**
   * Check if any reminders are currently showing.
   */
  ReminderOverlay.hasActive = function () {
    return active.size > 0;
  };

  // ==================== Helpers ====================

  function formatDuration(seconds) {
    if (seconds >= 3600) {
      const h = Math.floor(seconds / 3600);
      const m = Math.round((seconds % 3600) / 60);
      return m > 0 ? `${h}h${m}m` : `${h}h`;
    }
    const m = Math.round(seconds / 60);
    return `${m}min`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  console.log('[Reminder] Overlay initialized');
})();
