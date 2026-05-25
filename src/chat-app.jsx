/**
 * Chat App — Standalone Hermes client for the chat BrowserWindow.
 * Independent window, no drag/resize needed (OS handles that).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './chat.css';

/* ── Collapsible tool call component ── */

function ToolCall({ tool, emoji, label }) {
  const [open, setOpen] = useState(false);

  // Dedup: if label is same as tool name, don't show it expanded (nothing extra)
  const hasDetail = label && label !== tool;

  return (
    <div className="chat-tool-call" onClick={() => hasDetail && setOpen(!open)}>
      <div className={`chat-tool-header${hasDetail ? ' chat-tool-clickable' : ''}`}>
        <span className="chat-tool-arrow">{hasDetail ? (open ? '▾' : '▸') : '•'}</span>
        <span className="chat-tool-emoji">{emoji || '⚙️'}</span>
        <span className="chat-tool-name">{tool}</span>
        {hasDetail && !open && (
          <span className="chat-tool-preview">
            — {label.length > 60 ? label.slice(0, 57) + '…' : label}
          </span>
        )}
      </div>
      {hasDetail && open && (
        <div className="chat-tool-detail">
          <pre>{label}</pre>
        </div>
      )}
    </div>
  );
}

/* ── Markdown renderer — react-markdown with GFM ── */

function MessageContent({ content, tools, image, isStreaming }) {
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
      {image && (
        <img
          src={`data:image/png;base64,${image}`}
          alt=""
          style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}
          onClick={() => {
            const w = window.open('', '_blank', 'width=800,height=600');
            if (w) w.document.write(`<!DOCTYPE html><html><head><style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style></head><body><img src="data:image/png;base64,${image}"></body></html>`);
          }}
        />
      )}
      {tools && tools.length > 0 && (
        <div className="chat-tool-list">
          {tools.map((t, i) => <ToolCall key={i} {...t} />)}
        </div>
      )}
      {content && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
      )}
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
  const [streamingTools, setStreamingTools] = useState([]);
  const [nickname, setNickname] = useState('Hermes');
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState(() => localStorage.getItem('cloe-chat-model') || '');
  const [transparent, setTransparent] = useState(() => localStorage.getItem('cloe-chat-transparent') === 'true');

  const streamRef = useRef('');
  const toolsRef = useRef([]);
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  // ── Chat toggle shortcut (works when chat window is focused) ──
  useEffect(() => {
    const handler = (e) => {
      const stored = localStorage.getItem('cloe-chat-shortcut') || '';
      if (!stored) return;
      const parts = stored.toLowerCase().split('+');
      const key = parts[parts.length - 1];
      const wantCmd = parts.some(p => ['cmd', 'commandorcontrol', 'command'].includes(p));
      const wantCtrl = parts.some(p => ['control', 'ctrl'].includes(p));
      const wantAlt = parts.includes('alt');
      const wantShift = parts.includes('shift');

      if (e.metaKey === wantCmd && e.ctrlKey === wantCtrl &&
          e.altKey === wantAlt && e.shiftKey === wantShift &&
          e.key.toUpperCase() === key.toUpperCase()) {
        e.preventDefault();
        e.stopPropagation();
        window.electronAPI?.toggleChatWindow?.();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, streamingTools]);

  // Apply window opacity on mount and when transparent state changes
  useEffect(() => {
    const opacity = transparent ? 0.6 : 1.0;
    window.electronAPI?.setChatOpacity?.(opacity);
  }, [transparent]);

  const toggleOpacity = useCallback(() => {
    setTransparent(prev => {
      const next = !prev;
      localStorage.setItem('cloe-chat-transparent', String(next));
      return next;
    });
  }, []);

  // Health check + load nickname
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
    // Load nickname from config
    window.electronAPI?.getChatNickname?.().then((name) => {
      if (name && !cancelled) setNickname(name);
    }).catch(() => {});
    // Load LLM model list from Hermes config + provider API
    window.electronAPI?.hermesGetModels?.().then((result) => {
      if (!cancelled && result) {
        const modelList = result.models || [];
        setModels(modelList);
        // Set current model from config if not already in localStorage
        if (result.current && !localStorage.getItem('cloe-chat-model')) {
          setCurrentModel(result.current);
          localStorage.setItem('cloe-chat-model', result.current);
        }
      }
    }).catch(() => {});
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
      toolsRef.current.push({ tool: data.tool, emoji: data.emoji, label: data.label });
      setStreamingTools([...toolsRef.current]);
    });
    const unsubEnd = window.electronAPI?.onHermesEnd?.(() => {
      const c = streamRef.current;
      const t = toolsRef.current;
      streamRef.current = '';
      toolsRef.current = [];
      setStreamingContent('');
      setStreamingTools([]);
      if (c || t.length > 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: c, tools: t }]);
      }
      setSending(false);
      setConnected(true);
    });
    const unsubError = window.electronAPI?.onHermesError?.((data) => {
      const c = streamRef.current;
      const t = toolsRef.current;
      streamRef.current = '';
      toolsRef.current = [];
      setStreamingContent('');
      setStreamingTools([]);
      const msg = c ? `${c}\n\n⚠️ ${data.error}` : `⚠️ ${data.error}`;
      setMessages(prev => [...prev, { role: 'assistant', content: msg, tools: t }]);
      setSending(false);
      setConnected(false);
    });
    const unsubExternal = window.electronAPI?.onExternalChatMessage?.((data) => {
      setMessages(prev => [...prev, { role: data.role || 'assistant', content: data.content, image: data.image }]);
    });
    return () => { unsubDelta?.(); unsubTool?.(); unsubEnd?.(); unsubError?.(); unsubExternal?.(); };
  }, []);

  const send = useCallback(() => {
    if (!input.trim() || connected === false) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    if (!sending) {
      setSending(true);
      streamRef.current = '';
      toolsRef.current = [];
      setStreamingContent('');
      setStreamingTools([]);
    }
    window.electronAPI?.hermesSendMessage?.(msg, sessionId, currentModel || undefined);
  }, [input, sending, connected, sessionId, currentModel]);

  const stop = useCallback(() => {
    window.electronAPI?.hermesChatStop?.();
    // Finalize any already-streamed content into messages
    const c = streamRef.current;
    const t = toolsRef.current;
    streamRef.current = '';
    toolsRef.current = [];
    setStreamingContent('');
    setStreamingTools([]);
    if (c || t.length > 0) {
      setMessages(prev => [...prev, { role: 'assistant', content: c, tools: t }]);
    }
    setSending(false);
  }, []);

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
    setStreamingTools([]);
    setSending(false);
    streamRef.current = '';
    toolsRef.current = [];
  }, []);

  const onModelChange = useCallback((e) => {
    const v = e.target.value;
    setCurrentModel(v);
    localStorage.setItem('cloe-chat-model', v);
    // Actually switch the LLM model (updates Hermes config + restarts gateway)
    window.electronAPI?.hermesSwitchModel?.(v).then((result) => {
      if (result?.success) {
        // Gateway is restarting — show disconnected briefly
        setConnected(false);
        setTimeout(() => {
          window.electronAPI?.hermesCheckHealth?.().then((r) => {
            setConnected(r?.connected ?? false);
          }).catch(() => setConnected(false));
        }, 3000);
      }
    }).catch(() => {});
  }, []);

  const dotColor = connected === null ? '#888' : connected ? '#4cff88' : '#ff5f57';

  return (
    <div className="chat-root">
      {/* Title bar — drag region */}
      <div className="chat-titlebar" data-tauri-drag-region>
        <div className="chat-titlebar-left">
          <span className="chat-dot" style={{ background: dotColor }} />
          <span className="chat-title">{nickname}</span>
          {sessionId && <span className="chat-session-badge" title={sessionId}>Session</span>}
        </div>
        <div className="chat-titlebar-right">
          <button className="chat-btn" onClick={newSession} title="New session">+</button>
          <button
            className={`chat-btn${transparent ? ' chat-btn-active' : ''}`}
            onClick={toggleOpacity}
            title={transparent ? 'Make opaque' : 'Make transparent'}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 2v20" opacity={transparent ? 0.4 : 1} />
            </svg>
          </button>
          <button className="chat-btn chat-btn-close" onClick={() => window.electronAPI?.closeWindow?.()} title="Close">✕</button>
        </div>
      </div>

      {/* LLM model selector */}
      {models.length > 0 && (
        <div className="chat-model-row">
          <label className="chat-model-label">LLM</label>
          <select className="chat-model-select" value={currentModel} onChange={onModelChange}>
            {models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !sending && (
          <div className="chat-empty">
            {connected === false
              ? 'Cannot reach Hermes API\nEnsure api_server is enabled in hermes config'
              : connected
                ? `Say hi to ${nickname} ✨`
                : 'Connecting...'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <MessageContent content={m.content} tools={m.tools} image={m.image} />
          </div>
        ))}
        {(streamingContent || streamingTools.length > 0) && (
          <div className="chat-msg chat-msg-assistant">
            <MessageContent content={streamingContent} tools={streamingTools} isStreaming />
          </div>
        )}
        {sending && !streamingContent && streamingTools.length === 0 && (
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
          placeholder={connected === false ? 'Not connected' : `Message ${nickname}… (Enter to send)`}
          disabled={connected === false}
          rows={1}
        />
        <button
          className={sending ? 'chat-stop-btn' : 'chat-send-btn'}
          onClick={sending ? stop : send}
          disabled={!sending && (connected === false || !input.trim())}
          title={sending ? 'Stop' : 'Send'}
        >
          {sending ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ChatApp />);
