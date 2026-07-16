/**
 * TabSwitcher — Floating tab switcher overlay (Cmd+Tab style).
 *
 * Appears centered over the terminal content when the user holds the
 * switcher shortcut. Each press cycles the highlighted tab; releasing
 * switches to it and dismisses the panel.
 *
 * Pure presentational component — receives tabs and pendingTabId as props.
 */

import React from 'react';
import './tab-switcher.css';

export default function TabSwitcher({ tabs, pendingTabId }) {
  return (
    <div className="tab-switcher-overlay">
      <div className="tab-switcher-panel">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-switcher-item${tab.id === pendingTabId ? ' active' : ''}`}
          >
            <span className="tab-switcher-dot" />
            <span className="tab-switcher-title">{tab.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
