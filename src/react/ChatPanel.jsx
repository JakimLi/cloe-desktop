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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Lightweight markdown renderer for chat messages.
 * Handles: fenced code blocks (with optional language), inline code.
 * Preserves whitespace and line breaks for non-code content.
 */
function renderMarkdown(text) {
  const parts = [];
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  let lastIdx = 0;
  let match;

  while ((match = codeBlockRe.exec(text)) !== null) {
    // Text before code block
    if (match.index > lastIdx) {
      parts.push({ type: 'text', content: text.slice(lastIdx, match.index) });
    }
    parts.push({ type: 'codeblock', lang: match[1] || '', content: match[2].replace(/\n$/, '') });
    lastIdx = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIdx < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIdx) });
  }

  return parts;
}

/** Render inline code (backtick spans) within plain text */
function renderInlineCode(text) {
  const parts = [];
  const inlineRe = /`([^`\n]+)`/g;
  let lastIdx = 0;
  let match;

  while ((match = inlineRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'plain', content: text.slice(lastIdx, match.index) });
    }
    parts.push({ type: 'code', content: match[1] });
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    parts.push({ type: 'plain', content: text.slice(lastIdx) });
  }

  return parts.length === 0 ? [{ type: 'plain', content: text }] : parts;
}

/** Message content renderer with code block and image support */
function MessageContent({ content, image, isStreaming }) {
  const blocks = useMemo(() => renderMarkdown(content || ''), [content]);

  return (
    <div className="chat-msg-content">
      {image && (
        <img
          src={`data:image/png;base64,${image}`}
          alt=""
          style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}
          onClick={(e) => {
            // Open image in new window on click
            const w = window.open('', '_blank', 'width=800,height=600');
            if (w) w.document.write(`<!DOCTYPE html><html><head><style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh}img{max-width:100%;max-height:100vh}.close{position:fixed;top:12px;right:16px;color:#fff;font-size:24px;cursor:pointer;z-index:1;text-shadow:0 1px 4px rgba(0,0,0,.8);user-select:none}.close:hover{color:#ff6b6b}</style></head><body><span class="close" onclick="window.close()">✕</span><img src="data:image/png;base64,${image}"></body></html>`);
          }}
        />
      )}
      {blocks.map((block, i) => {
        if (block.type === 'codeblock') {
          return (
            <div key={i} className="chat-code-block">
              {block.lang && <div className="chat-code-lang">{block.lang}</div>}
              <pre className="chat-code-pre">
                <code>{block.content}</code>
              </pre>
            </div>
          );
        }
        // Text block — render with inline code support
        const inlines = renderInlineCode(block.content);
        return (
          <span key={i}>
            {inlines.map((seg, j) =>
              seg.type === 'code' ? (
                <code key={j} className="chat-inline-code">{seg.content}</code>
              ) : (
                <span key={j} className="chat-plain-text">{seg.content}</span>
              )
            )}
          </span>
        );
      })}
      {isStreaming && <span className="chat-cursor">▊</span>}
    </div>
  );
}

export default function ChatPanel({ visible, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [connected, setConnected] = useState(null); // null=checking, true/false
  const [pos, setPos] = useState(null); // {x,y} when dragged; null=CSS default
  const [size, setSize] = useState(null); // {w,h} when resized; null=CSS default
  const [streamingContent, setStreamingContent] = useState('');

  const streamRef = useRef('');
  const dragRef = useRef({ active: false, ox: 0, oy: 0 });
  const resizeRef = useRef({ active: false, startX: 0, startY: 0, startW: 0, startH: 0 });
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

    const unsubExternal = window.electronAPI?.onExternalChatMessage?.((data) => {
      setMessages(prev => [...prev, { role: data.role || 'assistant', content: data.content, image: data.image }]);
    });

    return () => {
      unsubDelta?.();
      unsubTool?.();
      unsubEnd?.();
      unsubError?.();
      unsubExternal?.();
    };
  }, [visible]);

  // ── Drag (global mouse events) ──
  useEffect(() => {
    const onMove = (e) => {
      if (dragRef.current.active) {
        setPos({ x: e.clientX - dragRef.current.ox, y: e.clientY - dragRef.current.oy });
      }
      if (resizeRef.current.active) {
        const r = resizeRef.current;
        const newW = Math.max(280, r.startW + (e.clientX - r.startX));
        const newH = Math.max(200, r.startH + (e.clientY - r.startY));
        setSize({ w: newW, h: newH });
      }
    };
    const onUp = () => {
      dragRef.current.active = false;
      resizeRef.current.active = false;
    };
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

  const onResizeMouseDown = useCallback((e) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    resizeRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    };
    if (!size) setSize({ w: rect.width, h: rect.height });
    e.preventDefault();
    e.stopPropagation();
  }, [size]);

  // ── Send message ──
  const send = useCallback(() => {
    if (!input.trim() || connected === false) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    if (!sending) {
      setSending(true);
      streamRef.current = '';
      setStreamingContent('');
    }
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
  const sizeStyle = size
    ? { width: size.w, height: size.h }
    : {};

  return (
    <div className="chat-panel" ref={panelRef} style={{ ...panelStyle, ...sizeStyle }}>
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
            <MessageContent content={m.content} image={m.image} />
          </div>
        ))}
        {streamingContent && (
          <div className="chat-msg chat-msg-assistant">
            <MessageContent content={streamingContent} isStreaming />
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
          disabled={connected === false}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={send}
          disabled={connected === false || !input.trim()}
          title="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>

      {/* ── Resize handle ── */}
      <div className="chat-resize-handle" onMouseDown={onResizeMouseDown} />
    </div>
  );
}
