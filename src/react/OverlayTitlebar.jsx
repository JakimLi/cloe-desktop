/**
 * OverlayTitlebar — macOS-style titlebar for the terminal/canvas overlay.
 * Traffic lights (hover reveal), mode switcher, drag region, opacity toggle (right).
 * Theme picker dropdown.
 */

import React, { useState, useRef, useEffect } from 'react';
import { TERMINAL_THEMES } from './terminalThemes';

const TRANSPARENCY_LABELS = {
  semi: '半透明 → 完全透明',
  full: '完全透明 → 不透明',
  opaque: '不透明 → 半透明',
};

function ThemePicker({ mode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const currentTheme = localStorage.getItem('cloe-terminal-theme') || 'cloe';

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Don't show theme picker in canvas mode
  if (mode === 'canvas') return null;

  const current = TERMINAL_THEMES.find(t => t.id === currentTheme) || TERMINAL_THEMES[0];

  return (
    <div className="theme-picker" ref={ref}>
      <button
        className="mode-btn theme-btn"
        title="Terminal Theme"
        onClick={() => setOpen(!open)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" opacity="0.4" />
        </svg>
        <span className="theme-swatch-row">
          {current.swatch.slice(0, 4).map((c, i) => (
            <span key={i} className="theme-swatch-dot" style={{ background: c }} />
          ))}
        </span>
      </button>
      {open && (
        <div className="theme-dropdown">
          <div className="theme-dropdown-header">Color Themes</div>
          <div className="theme-dropdown-list">
            {TERMINAL_THEMES.map(t => (
              <button
                key={t.id}
                className={`theme-option ${t.id === currentTheme ? 'active' : ''}`}
                onClick={() => {
                  window.cloeSetTerminalTheme?.(t.id);
                  setOpen(false);
                }}
              >
                <span className="theme-option-swatch">
                  {t.swatch.map((c, i) => (
                    <span key={i} className="theme-swatch-dot" style={{ background: c }} />
                  ))}
                </span>
                <span className="theme-option-info">
                  <span className="theme-option-name">{t.name}</span>
                  <span className="theme-option-desc">{t.desc}</span>
                </span>
                {t.id === currentTheme && (
                  <svg className="theme-check" width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OverlayTitlebar({ onClose, mode, onModeChange, onChatToggle, chatVisible, overlayTransparency, onToggleTransparent }) {
  return (
    <div className="terminal-titlebar">
      {/* Traffic lights (hover reveal) */}
      <div className="terminal-traffic-lights">
        <button className="traffic-light traffic-close" title="Exit Terminal" onClick={onClose} />
        <button className="traffic-light traffic-minimize" title="Minimize" onClick={() => window.electronAPI?.minimizeWindow?.()} />
        <button className="traffic-light traffic-fullscreen" title="Fullscreen" onClick={() => window.electronAPI?.toggleFullscreen?.()} />
      </div>

      {/* Mode switcher */}
      <div className="titlebar-mode-switcher">
        <button
          className={`mode-btn ${mode === 'terminal' ? 'active' : ''}`}
          title="Terminal"
          onClick={() => onModeChange('terminal')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1.5" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M3.5 5L5.5 7.5L3.5 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="6.5" y1="10" x2="9.5" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <line x1="2" y1="13.5" x2="14" y2="13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span className="mode-label">Terminal</span>
        </button>
        <button
          className={`mode-btn ${mode === 'canvas' ? 'active' : ''}`}
          title="Canvas"
          onClick={() => onModeChange('canvas')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M1 6H15" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M6 1V15" stroke="currentColor" strokeWidth="1.2"/>
            <circle cx="3.5" cy="3.5" r="1" fill="currentColor" opacity="0.5"/>
            <circle cx="12.5" cy="3.5" r="1" fill="currentColor" opacity="0.5"/>
            <circle cx="3.5" cy="8.5" r="1" fill="currentColor" opacity="0.5"/>
            <circle cx="3.5" cy="12.5" r="1" fill="currentColor" opacity="0.5"/>
          </svg>
          <span className="mode-label">Canvas</span>
        </button>
        <button
          className={`mode-btn ${chatVisible ? 'active' : ''}`}
          title="Hermes Chat"
          onClick={onChatToggle}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 2.5C1.5 1.67 2.17 1 3 1H13C13.83 1 14.5 1.67 14.5 2.5V9.5C14.5 10.33 13.83 11 13 11H5L2 14V11H3C2.17 11 1.5 10.33 1.5 9.5V2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="5" cy="6" r="0.8" fill="currentColor"/>
            <circle cx="8" cy="6" r="0.8" fill="currentColor"/>
            <circle cx="11" cy="6" r="0.8" fill="currentColor"/>
          </svg>
          <span className="mode-label">Chat</span>
        </button>
      </div>

      {/* Drag region fills the middle */}
      <div className="terminal-drag-region" />

      {/* Theme picker */}
      <ThemePicker mode={mode} />

      {/* Opacity toggle — top-right corner, 3-state cycle */}
      <button
        className={`mode-btn opacity-toggle${overlayTransparency !== 'semi' ? ' active' : ''}`}
        onClick={onToggleTransparent}
        title={TRANSPARENCY_LABELS[overlayTransparency] || '切换透明度'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2v20" opacity={overlayTransparency === 'full' ? 0.15 : overlayTransparency === 'semi' ? 0.4 : 1} />
        </svg>
      </button>
    </div>
  );
}
