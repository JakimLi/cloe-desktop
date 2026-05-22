/**
 * ChatPanel — Floating Hermes client chat window.
 *
 * Connects to local Hermes API Server (localhost:8642) via IPC proxy
 * in the main process (avoids CORS issues).
 *
 * Features:
 * - SSE streaming with real-time delta display
 * - Session continuity via X-Hermes-Session-Id
 * - Tool progress indicators
 * - Draggable positioning
 * - Connection health monitoring
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

export default function ChatPanel({ visible, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [connected, setConnected] = useState(null); // null=checking, true/false
  const [pos, setPos] = useState(null); // {x,y} when dragged; null=CSS default
  const [streamingContent, setStreamingContent] = useState('');

  const streamRef = useRef('');
  const dragRef = useRef({ active: false, ox: 0, oy: 0 });
  const endRef = useRef(null);
  const panelRef = useRef(null);

  // ── Auto-scroll ──
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // ── Health check ──
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const check = async () => {
      try {
        const r = await window.electronAPI?.hermesCheckHealth?.();
        if (!cancelled) setConnected(r?.connected ?? false);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    check();
    const iv = setInterval(check, 20000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [visible]);

  // ── Stream listeners (IPC from main process) ──
  useEffect(() => {
    if (!visible) return;

    const unsubDelta = window.electronAPI?.onHermesDelta?.((data) => {
      if (data.sessionId) setSessionId(data.sessionId);
      if (data.content) {
        streamRef.current += data.content;
        setStreamingContent(streamRef.current);
      }
    });

    const unsubTool = window.electronAPI?.onHermesTool?.((data) => {
      const t = `\n${data.emoji || '⚙️'} ${data.label || data.tool}\n`;
      streamRef.current += t;
      setStreamingContent(streamRef.current);
    });

    const unsubEnd = window.electronAPI?.onHermesEnd?.(() => {
      const c = streamRef.current;
      streamRef.current = '';
      setStreamingContent('');
      if (c) setMessages(prev => [...prev, { role: 'assistant', content: c }]);
      setSending(false);
      setConnected(true);
    });

    const unsubError = window.electronAPI?.onHermesError?.((data) => {
      const c = streamRef.current;
      streamRef.current = '';
      setStreamingContent('');
      const msg = c ? `${c}\n\n⚠️ ${data.error}` : `⚠️ ${data.error}`;
      setMessages(prev => [...prev, { role: 'assistant', content: msg }]);
      setSending(false);
      setConnected(false);
    });

    return () => {
      unsubDelta?.();
      unsubTool?.();
      unsubEnd?.();
      unsubError?.();
    };
  }, [visible]);

  // ── Drag (global mouse events) ──
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.active) return;
      setPos({ x: e.clientX - dragRef.current.ox, y: e.clientY - dragRef.current.oy });
    };
    const onUp = () => { dragRef.current.active = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onTitleMouseDown = useCallback((e) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      active: true,
      ox: e.clientX - rect.left,
      oy: e.clientY - rect.top,
    };
    // Switch from CSS default to absolute positioning
    setPos({ x: rect.left, y: rect.top });
    e.preventDefault();
  }, []);

  // ── Send message ──
  const send = useCallback(() => {
    if (!input.trim() || sending || connected === false) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setSending(true);
    streamRef.current = '';
    setStreamingContent('');
    window.electronAPI?.hermesSendMessage?.(msg, sessionId);
  }, [input, sending, connected, sessionId]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // ── Textarea auto-resize ──
  const textareaRef = useRef(null);
  const onInputChange = useCallback((e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  }, []);

  // ── New session ──
  const newSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setStreamingContent('');
    setSending(false);
    streamRef.current = '';
  }, []);

  if (!visible) return null;

  const dotColor = connected === null ? '#888' : connected ? '#4cff88' : '#ff5f57';
  const panelStyle = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : {};

  return (
    <div className="chat-panel" ref={panelRef} style={panelStyle}>
      {/* ── Title bar ── */}
      <div className="chat-panel-titlebar" onMouseDown={onTitleMouseDown}>
        <div className="chat-panel-titlebar-left">
          <span className="chat-dot" style={{ background: dotColor }} />
          <span className="chat-panel-title">Hermes</span>
          {sessionId && <span className="chat-session-badge" title={sessionId}>Session</span>}
        </div>
        <div className="chat-panel-titlebar-right">
          <button className="chat-panel-btn" onClick={newSession} title="New session">+</button>
          <button className="chat-panel-btn chat-panel-btn-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="chat-panel-messages">
        {messages.length === 0 && !sending && (
          <div className="chat-panel-empty">
            {connected === false
              ? 'Cannot reach Hermes API\nEnsure api_server is enabled in hermes config'
              : connected
                ? 'Say hi to Hermes ✨'
                : 'Connecting...'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-content">{m.content}</div>
          </div>
        ))}
        {streamingContent && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-msg-content">
              {streamingContent}<span className="chat-cursor">▊</span>
            </div>
          </div>
        )}
        {sending && !streamingContent && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* ── Input ── */}
      <div className="chat-panel-input-row">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder={connected === false ? 'Not connected' : 'Message Hermes... (Enter to send)'}
          disabled={connected === false || sending}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={send}
          disabled={connected === false || sending || !input.trim()}
          title="Send"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8L14 1L8 14L7 9L2 8Z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}
