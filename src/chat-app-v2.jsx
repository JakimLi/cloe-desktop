/**
 * Chat App v2 — Modern Minimalist Hermes client for the chat BrowserWindow.
 * 
 * Design philosophy: No chat bubbles. Messages are clean text blocks with
 * typographic hierarchy and ample whitespace. Inspired by Cue/Linear/Vercel.
 * 
 * Key differences from v1:
 * - User messages: right-aligned muted text, no background
 * - Assistant messages: full-width clean text, no avatar per message
 * - Tool calls: inline minimal badges, not boxed
 * - Loading: subtle pulse dots, not bouncing balls
 * - Streaming: text cursor, not blinking block
 * 
 * Window logic (transparency, pin, shortcuts) is identical to v1.
 * To revert: change chat.html script src from chat-app-v2 to chat-app
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './chat-v2.css';

/* ── Collapsible tool call — inline, minimal ── */

function ToolCall({ tool, emoji, label }) {
  const [open, setOpen] = useState(false);
  const hasDetail = label && label !== tool;

  return (
    <div className="chat-tool-call">
      <div
        className={`chat-tool-header${hasDetail ? ' chat-tool-clickable' : ''}`}
        onClick={() => hasDetail && setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}
      >
        <span className="chat-tool-arrow" style={open ? { transform: 'rotate(90deg)' } : {}}>▸</span>
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

/* ── Markdown renderer ── */

function MessageContent({ content, tools, image, isStreaming }) {
  const components = {
    pre({ children }) {
      return <div className="chat-code-block">{children}</div>;
    },
    code({ className, children, ...props }) {
      const lang = (className || '').replace(/^language-/, '');
      if (lang) {
        return (
          <>
            <div className="chat-code-lang">{lang}</div>
            <pre className="chat-code-pre">
              <code className={className} {...props}>{children}</code>
            </pre>
          </>
        );
      }
      const isBlock = typeof children === 'string' && children.includes('\n');
      if (isBlock) {
        return (
          <pre className="chat-code-pre">
            <code {...props}>{children}</code>
          </pre>
        );
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
          style={{
            maxWidth: '100%',
            borderRadius: 8,
            marginBottom: 8,
            cursor: 'pointer',
          }}
          onClick={() => {
            const w = window.open('', '_blank', 'width=800,height=600');
            if (w)
              w.document.write(
                `<!DOCTYPE html><html><head><style>body{margin:0;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style></head><body><img src="data:image/png;base64,${image}"></body></html>`
              );
          }}
        />
      )}
      {tools && tools.length > 0 && (
        <div className="chat-tool-list">
          {tools.map((t, i) => (
            <ToolCall key={i} {...t} />
          ))}
        </div>
      )}
      {content && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      )}
      {isStreaming && <span className="chat-cursor" />}
    </div>
  );
}

/* ── Avatar Cropper Modal (unchanged from v1) ── */

const CROP_SIZE = 200;

function AvatarCropper({ imageSrc, onConfirm, onCancel }) {
  const containerRef = useRef(null);
  const imgRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const dragRef = useRef({
    dragging: false,
    startX: 0,
    startY: 0,
    startOffX: 0,
    startOffY: 0,
  });

  const handleImgLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.target;
    setNaturalSize({ w: naturalWidth, h: naturalHeight });
    const fitScale = CROP_SIZE / Math.min(naturalWidth, naturalHeight);
    setScale(fitScale);
    const drawW = naturalWidth * fitScale;
    const drawH = naturalHeight * fitScale;
    setOffset({ x: (CROP_SIZE - drawW) / 2, y: (CROP_SIZE - drawH) / 2 });
  }, []);

  const onMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      dragRef.current = {
        dragging: true,
        startX: e.clientX,
        startY: e.clientY,
        startOffX: offset.x,
        startOffY: offset.y,
      };
    },
    [offset]
  );

  const onMouseMove = useCallback((e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({
      x: dragRef.current.startOffX + dx,
      y: dragRef.current.startOffY + dy,
    });
  }, []);

  const onMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const onWheel = useCallback(
    (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.95 : 1.05;
      setScale((prev) => {
        const next = prev * delta;
        const minScale = CROP_SIZE / Math.max(naturalSize.w, naturalSize.h);
        return Math.max(minScale, next);
      });
    },
    [naturalSize]
  );

  const handleConfirm = useCallback(() => {
    const canvas = document.createElement('canvas');
    const outSize = 128;
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(outSize / 2, outSize / 2, outSize / 2, 0, Math.PI * 2);
    ctx.clip();
    const ratio = outSize / CROP_SIZE;
    const dx = offset.x * ratio;
    const dy = offset.y * ratio;
    const dw = naturalSize.w * scale * ratio;
    const dh = naturalSize.h * scale * ratio;
    ctx.drawImage(imgRef.current, dx, dy, dw, dh);
    const result = canvas.toDataURL('image/png');
    onConfirm(result);
  }, [offset, scale, naturalSize, onConfirm]);

  const drawW = naturalSize.w * scale;
  const drawH = naturalSize.h * scale;

  return (
    <div
      className="avatar-cropper-overlay"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className="avatar-cropper-modal">
        <div className="avatar-cropper-title">Crop Avatar</div>
        <div
          className="avatar-cropper-area"
          ref={containerRef}
          onMouseDown={onMouseDown}
          onWheel={onWheel}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            draggable={false}
            onLoad={handleImgLoad}
            className="avatar-cropper-img"
            style={{
              width: drawW,
              height: drawH,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }}
          />
          <div className="avatar-cropper-mask">
            <div className="avatar-cropper-hole" />
          </div>
        </div>
        <div className="avatar-cropper-hint">Drag to pan · Scroll to zoom</div>
        <div className="avatar-cropper-actions">
          <button className="avatar-cropper-btn avatar-cropper-cancel" onClick={onCancel}>
            ✕ Cancel
          </button>
          <button className="avatar-cropper-btn avatar-cropper-confirm" onClick={handleConfirm}>
            ✓ Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shortcut helper ── */
function useShortcut(storageKey, handler) {
  useEffect(() => {
    if (!handler) return;
    const fn = (e) => {
      const stored = localStorage.getItem(storageKey) || '';
      if (!stored) return;
      const parts = stored.toLowerCase().split('+');
      const key = parts[parts.length - 1];
      const wantCmd = parts.some((p) =>
        ['cmd', 'commandorcontrol', 'command'].includes(p)
      );
      const wantCtrl = parts.some((p) => ['control', 'ctrl'].includes(p));
      const wantAlt = parts.includes('alt');
      const wantShift = parts.includes('shift');
      if (
        e.metaKey === wantCmd &&
        e.ctrlKey === wantCtrl &&
        e.altKey === wantAlt &&
        e.shiftKey === wantShift &&
        e.key.toUpperCase() === key.toUpperCase()
      ) {
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    };
    document.addEventListener('keydown', fn, true);
    return () => document.removeEventListener('keydown', fn, true);
  }, [storageKey, handler]);
}

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */
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
  const [currentModel, setCurrentModel] = useState(
    () => localStorage.getItem('cloe-chat-model') || ''
  );
  const [focusedIndex, setFocusedIndex] = useState(null);
  const [transparent, setTransparent] = useState(
    () => localStorage.getItem('cloe-chat-transparent') === 'true'
  );
  const [penetrate, setPenetrate] = useState(
    () => localStorage.getItem('cloe-chat-penetrate') === 'true'
  );
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [cropperSrc, setCropperSrc] = useState(null);
  const [contextPct, setContextPct] = useState(0);

  const streamRef = useRef('');
  const toolsRef = useRef([]);
  const endRef = useRef(null);
  const textareaRef = useRef(null);

  /* ── Shortcuts ── */
  useShortcut('cloe-chat-shortcut', () => window.electronAPI?.toggleChatWindow?.());
  useShortcut('cloe-transparency-shortcut', () =>
    setTransparent((prev) => {
      const next = !prev;
      localStorage.setItem('cloe-chat-transparent', String(next));
      return next;
    })
  );
  useShortcut('cloe-chat-pin-shortcut', () =>
    setPenetrate((prev) => {
      const next = !prev;
      localStorage.setItem('cloe-chat-penetrate', String(next));
      return next;
    })
  );
  useShortcut('cloe-chat-focus-shortcut', () => textareaRef.current?.focus());

  /* ── Auto-scroll ── */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, streamingTools]);

  /* ── ESC to exit focus mode ── */
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && focusedIndex !== null) {
        setFocusedIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex]);

  /* ── Window opacity ── */
  useEffect(() => {
    const opacity = transparent ? 0.6 : 1.0;
    window.electronAPI?.setChatOpacity?.(opacity);
  }, [transparent]);

  /* ── Fullscreen penetrate ── */
  useEffect(() => {
    window.electronAPI?.setFullscreenPenetrate?.(penetrate);
  }, [penetrate]);

  const toggleOpacity = useCallback(() => {
    setTransparent((prev) => {
      const next = !prev;
      localStorage.setItem('cloe-chat-transparent', String(next));
      return next;
    });
  }, []);

  const togglePenetrate = useCallback(() => {
    setPenetrate((prev) => {
      const next = !prev;
      localStorage.setItem('cloe-chat-penetrate', String(next));
      return next;
    });
  }, []);

  /* ── Avatar ── */
  useEffect(() => {
    window.electronAPI
      ?.getChatAvatar?.()
      .then((url) => {
        if (url) setAvatarUrl(url);
      })
      .catch(() => {});
  }, []);

  const handleAvatarClick = useCallback(async () => {
    const url = await window.electronAPI?.selectChatAvatar?.();
    if (url) setCropperSrc(url);
  }, []);

  const handleCropConfirm = useCallback(async (croppedDataUrl) => {
    setCropperSrc(null);
    const saved = await window.electronAPI?.saveChatAvatar?.(croppedDataUrl);
    if (saved) {
      setAvatarUrl(croppedDataUrl);
    }
  }, []);

  const handleCropCancel = useCallback(() => {
    setCropperSrc(null);
  }, []);

  const handleAvatarContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!avatarUrl) {
        handleAvatarClick();
        return;
      }
      const menu = document.createElement('div');
      menu.className = 'chat-avatar-menu';
      menu.innerHTML = `
        <div class="chat-avatar-menu-item" data-action="change">Change avatar</div>
        <div class="chat-avatar-menu-item chat-avatar-menu-danger" data-action="remove">Remove avatar</div>
      `;
      menu.style.position = 'fixed';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
      document.body.appendChild(menu);

      const handleClick = async (ev) => {
        const action = ev.target.dataset.action;
        menu.remove();
        document.removeEventListener('click', handleClick);
        if (action === 'change') {
          const url = await window.electronAPI?.selectChatAvatar?.();
          if (url) setCropperSrc(url);
        } else if (action === 'remove') {
          await window.electronAPI?.removeChatAvatar?.();
          setAvatarUrl(null);
        }
      };
      setTimeout(() => document.addEventListener('click', handleClick), 0);
    },
    [avatarUrl, handleAvatarClick]
  );

  /* ── Health check + load nickname + models ── */
  useEffect(() => {
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
    window.electronAPI
      ?.getChatNickname?.()
      .then((name) => {
        if (name && !cancelled) setNickname(name);
      })
      .catch(() => {});
    window.electronAPI
      ?.hermesGetModels?.()
      .then((result) => {
        if (!cancelled && result) {
          const modelList = result.models || [];
          setModels(modelList);
          if (result.current && !localStorage.getItem('cloe-chat-model')) {
            setCurrentModel(result.current);
            localStorage.setItem('cloe-chat-model', result.current);
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  /* ── Stream listeners ── */
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
        setMessages((prev) => [...prev, { role: 'assistant', content: c, tools: t }]);
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
      const errMsg = data.error || 'Unknown error';
      const msg = c ? `${c}\n\n---\n\n**Error:** ${errMsg}` : `**Error:** ${errMsg}`;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: msg, tools: t, isError: true },
      ]);
      setSending(false);
      setConnected(false);
    });
    const unsubExternal = window.electronAPI?.onExternalChatMessage?.((data) => {
      setMessages((prev) => [
        ...prev,
        { role: data.role || 'assistant', content: data.content, image: data.image },
      ]);
    });
    const unsubCtxUsage = window.electronAPI?.onContextUsage?.((data) => {
      if (typeof data.usage_pct === 'number') setContextPct(data.usage_pct);
    });
    return () => {
      unsubDelta?.();
      unsubTool?.();
      unsubEnd?.();
      unsubError?.();
      unsubExternal?.();
      unsubCtxUsage?.();
    };
  }, []);

  const send = useCallback(() => {
    if (!input.trim() || connected === false) return;
    const msg = input.trim().replace(/\n/g, '  \n');
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    if (!sending) {
      setSending(true);
      streamRef.current = '';
      toolsRef.current = [];
      setStreamingContent('');
      setStreamingTools([]);
    }
    window.electronAPI?.hermesSendMessage?.(input.trim(), sessionId, currentModel || undefined);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, sending, connected, sessionId, currentModel]);

  const stop = useCallback(() => {
    window.electronAPI?.hermesChatStop?.();
    const c = streamRef.current;
    const t = toolsRef.current;
    streamRef.current = '';
    toolsRef.current = [];
    setStreamingContent('');
    setStreamingTools([]);
    if (c || t.length > 0) {
      setMessages((prev) => [...prev, { role: 'assistant', content: c, tools: t }]);
    }
    setSending(false);
  }, []);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey || e.altKey) {
        e.preventDefault();
        const { selectionStart, selectionEnd } = e.target;
        setInput((prev) => {
          const next = prev.substring(0, selectionStart) + '\n' + prev.substring(selectionEnd);
          requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) {
              ta.selectionStart = ta.selectionEnd = selectionStart + 1;
              ta.style.height = 'auto';
              ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
            }
          });
          return next;
        });
      } else {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

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
    window.electronAPI?.hermesSwitchModel?.(v).then((result) => {
      if (result?.success) {
        setConnected(false);
        setTimeout(() => {
          window.electronAPI
            ?.hermesCheckHealth?.()
            .then((r) => {
              setConnected(r?.connected ?? false);
            })
            .catch(() => setConnected(false));
        }, 3000);
      }
    }).catch(() => {});
  }, []);

  const dotColor = connected === null ? '#888' : connected ? '#4cff88' : '#ff5f57';

  /* ── Render helpers ── */
  const renderTitlebarAvatar = () => (
    <div
      className={`chat-titlebar-avatar${avatarUrl ? '' : ' chat-titlebar-avatar-default'}`}
      onClick={handleAvatarClick}
      onContextMenu={handleAvatarContextMenu}
      title={avatarUrl ? 'Right-click to change/remove avatar' : 'Click to set AI avatar'}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="AI" draggable={false} />
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
        </svg>
      )}
    </div>
  );

  return (
    <div className={`chat-root${transparent ? ' chat-root-transparent' : ''}`}>
      {/* Title bar */}
      <div className="chat-titlebar" data-tauri-drag-region>
        <div className="chat-titlebar-left">
          {renderTitlebarAvatar()}
          <span className="chat-title">{nickname}</span>
          {sessionId && (
            <span className="chat-session-badge" title={sessionId}>
              Session
            </span>
          )}
        </div>
        <div className="chat-titlebar-right">
          <button className="chat-btn" onClick={newSession} title="New session">
            +
          </button>
          <button
            className={`chat-btn${transparent ? ' chat-btn-active' : ''}`}
            onClick={toggleOpacity}
            title={transparent ? 'Make opaque' : 'Make transparent'}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 2v20" opacity={transparent ? 0.4 : 1} />
            </svg>
          </button>
          <button
            className={`chat-btn${penetrate ? ' chat-btn-active' : ''}`}
            onClick={togglePenetrate}
            title={penetrate ? 'Disable fullscreen overlay' : 'Float over fullscreen'}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill={penetrate ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z" />
            </svg>
          </button>
          <button
            className="chat-btn chat-btn-close"
            onClick={() => window.electronAPI?.closeWindow?.()}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages — no bubbles, clean text flow */}
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
          <div
            key={i}
            className={`chat-msg chat-msg-${m.role}${m.isError ? ' chat-msg-error' : ''}`}
            onDoubleClick={() => setFocusedIndex(i)}
          >
            {/* Tool separator before assistant messages that have tools */}
            {m.role === 'assistant' && m.tools && m.tools.length > 0 && i > 0 && (
              <div className="chat-tool-separator" />
            )}
            <MessageContent content={m.content} tools={m.tools} image={m.image} />
          </div>
        ))}

        {/* Streaming content */}
        {(streamingContent || streamingTools.length > 0) && (
          <div className="chat-streaming">
            {streamingTools.length > 0 && messages.length > 0 && (
              <div className="chat-tool-separator" />
            )}
            <MessageContent
              content={streamingContent}
              tools={streamingTools}
              isStreaming
            />
          </div>
        )}

        {/* Thinking / loading indicator */}
        {sending && !streamingContent && streamingTools.length === 0 && (
          <div className="chat-thinking">
            <div className="chat-thinking-bar">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Focus modal overlay */}
      {focusedIndex !== null && messages[focusedIndex] && (
        <div className="chat-focus-overlay" onClick={() => setFocusedIndex(null)}>
          <div className="chat-focus-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chat-focus-modal-header">
              <span className="chat-focus-modal-label">
                {messages[focusedIndex].role === 'user' ? 'You' : nickname}
              </span>
              <button
                className="chat-btn"
                onClick={() => setFocusedIndex(null)}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
            <div className="chat-focus-modal-body">
              <div className={`chat-focus-bubble chat-focus-bubble-${messages[focusedIndex].role}`}>
                <MessageContent
                  content={messages[focusedIndex].content}
                  tools={messages[focusedIndex].tools}
                  image={messages[focusedIndex].image}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          placeholder={
            connected === false ? 'Not connected' : `Message ${nickname}…`
          }
          disabled={connected === false}
          rows={1}
        />
        <div className="chat-input-actions">
          {models.length > 1 && (
            <div className="chat-model-select-wrapper">
              <span className="chat-dot chat-dot-model" style={{ background: dotColor }} />
              <select
                className="chat-model-select"
                value={currentModel}
                onChange={onModelChange}
                title="Switch model"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
          {models.length <= 1 && (
            <span className="chat-dot chat-dot-model" style={{ background: dotColor }} />
          )}
          <button
            className={
              sending ? 'chat-action-btn chat-stop-btn' : 'chat-action-btn chat-send-btn'
            }
            onClick={sending ? stop : send}
            disabled={!sending && (connected === false || !input.trim())}
            title={sending ? 'Stop' : 'Send'}
          >
            {sending ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Context usage indicator */}
      <div className="chat-context-bar">
        <svg viewBox="0 0 36 36" className="chat-context-svg">
          <path
            className="chat-context-bg"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path
            className={`chat-context-fill${
              contextPct >= 90
                ? ' critical'
                : contextPct >= 75
                  ? ' danger'
                  : contextPct >= 50
                    ? ' warn'
                    : ''
            }`}
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            strokeDasharray={`${Math.max(0, Math.min(100, contextPct))}, 100`}
          />
        </svg>
        <span className="chat-context-text">{Math.round(contextPct)}% context</span>
      </div>

      {/* Avatar Cropper Modal */}
      {cropperSrc && (
        <AvatarCropper
          imageSrc={cropperSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ChatApp />);
