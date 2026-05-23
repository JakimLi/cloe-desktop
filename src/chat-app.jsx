/**
 * Chat App — Standalone Hermes client for the chat BrowserWindow.
 * Independent window, no drag/resize needed (OS handles that).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './chat.css';

/* ── Markdown renderer — react-markdown with GFM ── */

function MessageContent({ content, isStreaming }) {
  const components = {
    pre({ children }) {
      return <div className="chat-code-block">{children}</div>;
    },
    code({ className, children, ...props }) {
      const lang = (className || '').replace(/^language-/, '');
      if (lang) {
        return <><div className="chat-code-lang">{lang}</div><pre className="chat-code-pre"><code className={className} {...props}>{children}</code></pre></>;
      }
      // Inline code — check if it's inside a pre (parent handles block code)
      const isBlock = typeof children === 'string' && children.includes('\n');
      if (isBlock) {
        return <pre className="chat-code-pre"><code {...props}>{children}</code></pre>;
      }
      return <code className="chat-inline-code" {...props}>{children}</code>;
    },
  };

  return (
    <div className="chat-msg-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
      {isStreaming && <span className="chat-cursor">▊</span>}
    </div>
  );
}

/* ── Main component ── */

function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [connected, setConnected] = useState(null);
  const [streamingContent, setStreamingContent] = useState('');

  const streamRef = useRef('');
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Health check
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await window.electronAPI?.hermesCheckHealth?.();
        if (!cancelled) setConnected(r?.connected ?? false);
      } catch { if (!cancelled) setConnected(false); }
    };
    check();
    const iv = setInterval(check, 20000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Stream listeners
  useEffect(() => {
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
    return () => { unsubDelta?.(); unsubTool?.(); unsubEnd?.(); unsubError?.(); };
  }, []);

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
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }, [send]);

  const onInputChange = useCallback((e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  }, []);

  const newSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setStreamingContent('');
    setSending(false);
    streamRef.current = '';
  }, []);

  const dotColor = connected === null ? '#888' : connected ? '#4cff88' : '#ff5f57';

  return (
    <div className="chat-root">
      {/* Title bar — drag region */}
      <div className="chat-titlebar" data-tauri-drag-region>
        <div className="chat-titlebar-left">
          <span className="chat-dot" style={{ background: dotColor }} />
          <span className="chat-title">Hermes</span>
          {sessionId && <span className="chat-session-badge" title={sessionId}>Session</span>}
        </div>
        <div className="chat-titlebar-right">
          <button className="chat-btn" onClick={newSession} title="New session">+</button>
          <button className="chat-btn chat-btn-close" onClick={() => window.electronAPI?.closeWindow?.()} title="Close">✕</button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !sending && (
          <div className="chat-empty">
            {connected === false
              ? 'Cannot reach Hermes API\nEnsure api_server is enabled in hermes config'
              : connected
                ? 'Say hi to Hermes ✨'
                : 'Connecting...'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <MessageContent content={m.content} />
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

      {/* Input */}
      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder={connected === false ? 'Not connected' : 'Message Hermes… (Enter to send)'}
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
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ChatApp />);
