/**
 * Chat App — Hermes client for the chat BrowserWindow.
 *
 * Design: No chat bubbles. Clean text blocks with typographic hierarchy
 * and ample whitespace. Inspired by Cue/Linear/Vercel.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import './chat.css';

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
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
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
   Main Component — Multi-session chat
   ═══════════════════════════════════════════════════════ */
function ChatApp() {
  const sessionsRef = useRef([]);
  const [sessions, setSessions] = useState([]);
  const [activeLocalId, setActiveLocalId] = useState(null);

  // Keep refs in sync for use inside the stable stream listener
  useEffect(() => { activeLocalIdRef.current = activeLocalId; }, [activeLocalId]);
  const [showSessionList, setShowSessionList] = useState(false);

  const streamDataRef = useRef({});
  const [streamingMap, setStreamingMap] = useState({});
  const [sendingMap, setSendingMap] = useState({});
  const sendingMapRef = useRef({});       // mirror of sendingMap for stable listener access
  const activeLocalIdRef = useRef(null);  // mirror of activeLocalId

  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(null);
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

  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const nextLocalIdRef = useRef(1);

  const createSession = useCallback((opts = {}) => {
    const localId = `s${nextLocalIdRef.current++}`;
    const session = {
      localId,
      sessionId: opts.sessionId || null,
      title: opts.title || 'New chat',
      messages: opts.messages || [],
      createdAt: Date.now(),
    };
    sessionsRef.current = [...sessionsRef.current, session];
    setSessions([...sessionsRef.current]);
    streamDataRef.current[localId] = { content: '', tools: [] };
    setActiveLocalId(localId);
    return localId;
  }, []);

  const updateSession = useCallback((localId, updater) => {
    sessionsRef.current = sessionsRef.current.map(s =>
      s.localId === localId ? { ...s, ...updater(s) } : s
    );
    setSessions([...sessionsRef.current]);
  }, []);

  useEffect(() => {
    if (sessionsRef.current.length === 0) {
      createSession();
    }
  }, [createSession]);

  const activeSession = sessions.find(s => s.localId === activeLocalId) || sessions[0];
  const activeStreaming = activeLocalId ? (streamingMap[activeLocalId] || { content: '', tools: [] }) : { content: '', tools: [] };
  const activeSending = activeLocalId ? (sendingMap[activeLocalId] || false) : false;

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages, activeStreaming?.content, activeStreaming?.tools]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showSessionList) { setShowSessionList(false); return; }
        if (focusedIndex !== null) setFocusedIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, showSessionList]);

  useEffect(() => {
    window.electronAPI?.setChatOpacity?.(transparent ? 0.6 : 1.0);
  }, [transparent]);

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

  useEffect(() => {
    window.electronAPI?.getChatAvatar?.()
      .then((url) => { if (url) setAvatarUrl(url); })
      .catch(() => {});
  }, []);

  const handleAvatarClick = useCallback(async () => {
    const url = await window.electronAPI?.selectChatAvatar?.();
    if (url) setCropperSrc(url);
  }, []);

  const handleCropConfirm = useCallback(async (croppedDataUrl) => {
    setCropperSrc(null);
    const saved = await window.electronAPI?.saveChatAvatar?.(croppedDataUrl);
    if (saved) setAvatarUrl(croppedDataUrl);
  }, []);

  const handleCropCancel = useCallback(() => setCropperSrc(null), []);

  const handleAvatarContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!avatarUrl) { handleAvatarClick(); return; }
    const menu = document.createElement('div');
    menu.className = 'chat-avatar-menu';
    menu.innerHTML = `<div class="chat-avatar-menu-item" data-action="change">Change avatar</div><div class="chat-avatar-menu-item chat-avatar-menu-danger" data-action="remove">Remove avatar</div>`;
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
  }, [avatarUrl, handleAvatarClick]);

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
    window.electronAPI?.getChatNickname?.()
      .then((name) => { if (name && !cancelled) setNickname(name); })
      .catch(() => {});
    window.electronAPI?.hermesGetModels?.()
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
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  useEffect(() => {
    const unsubDelta = window.electronAPI?.onHermesDelta?.((data) => {
      if (!data.sessionId) return;
      // Look up by Hermes session ID first, then by "pending" sessions (sending but no sessionId yet)
      let target = sessionsRef.current.find(s => s.sessionId === data.sessionId);
      if (!target) {
        const sm = sendingMapRef.current;
        target = sessionsRef.current.find(s => !s.sessionId && sm[s.localId]);
        if (target) {
          updateSession(target.localId, () => ({
            sessionId: data.sessionId,
            title: data.sessionId.slice(0, 8),
          }));
        }
      }
      if (!target || !data.content) return;
      const lid = target.localId;
      if (!streamDataRef.current[lid]) streamDataRef.current[lid] = { content: '', tools: [] };
      streamDataRef.current[lid].content += data.content;
      setStreamingMap((prev) => ({
        ...prev,
        [lid]: { content: streamDataRef.current[lid].content, tools: streamDataRef.current[lid].tools },
      }));
    });

    const unsubTool = window.electronAPI?.onHermesTool?.((data) => {
      // Route to the most recently started sending session that has no sessionId match
      const sm = sendingMapRef.current;
      const sendingLids = Object.keys(sm).filter(k => sm[k]);
      if (sendingLids.length === 0) return;
      const lid = sendingLids[sendingLids.length - 1];
      if (!streamDataRef.current[lid]) streamDataRef.current[lid] = { content: '', tools: [] };
      streamDataRef.current[lid].tools.push({ tool: data.tool, emoji: data.emoji, label: data.label });
      setStreamingMap((prev) => ({
        ...prev,
        [lid]: { content: streamDataRef.current[lid].content, tools: [...streamDataRef.current[lid].tools] },
      }));
    });

    const unsubEnd = window.electronAPI?.onHermesEnd?.(() => {
      // Finalize ONLY sessions that have accumulated streaming content
      const sm = sendingMapRef.current;
      for (const [lid, sd] of Object.entries(streamDataRef.current)) {
        if (sd.content || sd.tools.length > 0) {
          updateSession(lid, (s) => ({
            messages: [...s.messages, { role: 'assistant', content: sd.content, tools: sd.tools }],
          }));
        }
        streamDataRef.current[lid] = { content: '', tools: [] };
        // Clear this session's sending flag only
        if (sm[lid]) {
          const ns = { ...sm }; delete ns[lid]; sendingMapRef.current = ns;
        }
      }
      // Update sendingMap state to match ref
      setSendingMap({ ...sendingMapRef.current });
      // Clear streaming for sessions that just ended
      setStreamingMap((prev) => {
        const next = {}; for (const k of Object.keys(prev)) { if (sendingMapRef.current[k]) next[k] = prev[k]; } return next;
      });
      setConnected(true);
    });

    const unsubError = window.electronAPI?.onHermesError?.((data) => {
      const sm = sendingMapRef.current;
      for (const [lid, sd] of Object.entries(streamDataRef.current)) {
        if (sd.content || sd.tools.length > 0 || sm[lid]) {
          const errMsg = data.error || 'Unknown error';
          const msg = sd.content ? `${sd.content}\n\n---\n\n**Error:** ${errMsg}` : `**Error:** ${errMsg}`;
          updateSession(lid, (s) => ({
            messages: [...s.messages, { role: 'assistant', content: msg, tools: sd.tools, isError: true }],
          }));
        }
        streamDataRef.current[lid] = { content: '', tools: [] };
      }
      sendingMapRef.current = {};
      setSendingMap({});
      setStreamingMap({});
      setConnected(false);
    });

    const unsubExternal = window.electronAPI?.onExternalChatMessage?.((data) => {
      const lid = activeLocalIdRef.current;
      if (!lid) return;
      updateSession(lid, (s) => ({
        messages: [...s.messages, { role: data.role || 'assistant', content: data.content, image: data.image }],
      }));
    });

    const unsubCtxUsage = window.electronAPI?.onContextUsage?.((data) => {
      if (typeof data.usage_pct !== 'number') return;
      const target = data.session_id ? sessionsRef.current.find(s => s.sessionId === data.session_id) : null;
      if (data.session_id && target && target.localId !== activeLocalIdRef.current) return;
      setContextPct(data.usage_pct);
    });

    return () => {
      unsubDelta?.(); unsubTool?.(); unsubEnd?.();
      unsubError?.(); unsubExternal?.(); unsubCtxUsage?.();
    };
  }, []); // EMPTY deps — listener registered once, uses refs for mutable state

  const send = useCallback(() => {
    if (!input.trim() || connected === false || !activeLocalId) return;
    const msg = input.trim();
    const lid = activeLocalId;
    const currentHermesSid = activeSession?.sessionId;
    setInput('');
    updateSession(lid, (s) => ({
      messages: [...s.messages, { role: 'user', content: msg }],
    }));
    streamDataRef.current[lid] = { content: '', tools: [] };
    setStreamingMap((prev) => ({ ...prev, [lid]: { content: '', tools: [] } }));
    setSendingMap((prev) => { const n = { ...prev, [lid]: true }; sendingMapRef.current = n; return n; });
    window.electronAPI?.hermesSendMessage?.(msg, currentHermesSid || undefined, currentModel || undefined);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, connected, activeLocalId, activeSession, currentModel]);

  const stop = useCallback(() => {
    if (!activeLocalId) return;
    const lid = activeLocalId;
    window.electronAPI?.hermesChatStop?.();
    const sd = streamDataRef.current[lid];
    if (sd && (sd.content || sd.tools.length > 0)) {
      updateSession(lid, (s) => ({
        messages: [...s.messages, { role: 'assistant', content: sd.content, tools: sd.tools }],
      }));
    }
    streamDataRef.current[lid] = { content: '', tools: [] };
    setStreamingMap((prev) => { const n = { ...prev }; delete n[lid]; return n; });
    const ns = { ...sendingMapRef.current }; delete ns[lid]; sendingMapRef.current = ns;
    setSendingMap(ns);
  }, [activeLocalId]);

  const onKeyDown = useCallback((e) => {
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
  }, [send]);

  const onInputChange = useCallback((e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  }, []);

  const newSessionInWindow = useCallback(() => {
    createSession();
    setShowSessionList(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [createSession]);

  const newSessionInNewWindow = useCallback(() => {
    window.electronAPI?.openNewChatWindow?.();
    setShowSessionList(false);
  }, []);

  const switchSession = useCallback((localId) => {
    setActiveLocalId(localId);
    setShowSessionList(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const closeSession = useCallback((localId, e) => {
    e?.stopPropagation();
    const remaining = sessionsRef.current.filter(s => s.localId !== localId);
    if (remaining.length === 0) {
      sessionsRef.current = [];
      delete streamDataRef.current[localId];
      createSession();
    } else {
      sessionsRef.current = remaining;
      delete streamDataRef.current[localId];
    }
    setSessions([...sessionsRef.current]);
    if (activeLocalId === localId) {
      setActiveLocalId(sessionsRef.current[0]?.localId || null);
    }
  }, [activeLocalId, createSession]);

  const onModelChange = useCallback((e) => {
    const v = e.target.value;
    setCurrentModel(v);
    localStorage.setItem('cloe-chat-model', v);
    window.electronAPI?.hermesSwitchModel?.(v).then((result) => {
      if (result?.success) {
        setConnected(false);
        setTimeout(() => {
          window.electronAPI?.hermesCheckHealth?.()
            .then((r) => setConnected(r?.connected ?? false))
            .catch(() => setConnected(false));
        }, 3000);
      }
    }).catch(() => {});
  }, []);

  const dotColor = connected === null ? '#888' : connected ? '#4cff88' : '#ff5f57';

  const renderTitlebarAvatar = () => (
    <div
      className={`chat-titlebar-avatar${avatarUrl ? '' : ' chat-titlebar-avatar-default'}`}
      onClick={handleAvatarClick}
      onContextMenu={handleAvatarContextMenu}
      title={avatarUrl ? 'Right-click for avatar options' : 'Click to set avatar'}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="AI" draggable={false} />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
        </svg>
      )}
    </div>
  );

  const messages = activeSession?.messages || [];
  const activeSid = activeSession?.sessionId;

  return (
    <div className={`chat-root${transparent ? ' chat-root-transparent' : ''}`}>
      <div className="chat-titlebar" data-tauri-drag-region>
        <div className="chat-titlebar-left">
          {renderTitlebarAvatar()}
          <span className="chat-title">{nickname}</span>
          {activeSid && (
            <span className="chat-session-badge" title={activeSid}>
              {sessions.length > 1 ? `${sessions.findIndex(s => s.localId === activeLocalId) + 1}/${sessions.length}` : 'Session'}
            </span>
          )}
          {sessions.length > 1 && (
            <button className="chat-btn chat-session-switcher-btn" onClick={() => setShowSessionList(!showSessionList)} title="Switch session">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
          )}
        </div>
        <div className="chat-titlebar-right">
          <button className="chat-btn" onClick={newSessionInWindow} onContextMenu={(e) => { e.preventDefault(); newSessionInNewWindow(); }} title="New session (right-click: new window)">+</button>
          <button className={`chat-btn${transparent ? ' chat-btn-active' : ''}`} onClick={toggleOpacity} title={transparent ? 'Make opaque' : 'Make transparent'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M12 2v20" opacity={transparent ? 0.4 : 1} />
            </svg>
          </button>
          <button className={`chat-btn${penetrate ? ' chat-btn-active' : ''}`} onClick={togglePenetrate} title={penetrate ? 'Disable fullscreen overlay' : 'Float over fullscreen'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill={penetrate ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z" />
            </svg>
          </button>
          <button className="chat-btn chat-btn-close" onClick={() => window.electronAPI?.closeWindow?.()} title="Close">✕</button>
        </div>
      </div>

      {showSessionList && (
        <>
          <div className="chat-session-overlay" onClick={() => setShowSessionList(false)} />
          <div className="chat-session-drawer">
            <div className="chat-session-drawer-header">
              <span className="chat-session-drawer-title">Sessions</span>
              <button className="chat-session-new-window-btn" onClick={newSessionInNewWindow} title="Open new window">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M21 3l-9 9" />
                  <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                </svg>
                New window
              </button>
            </div>
            <div className="chat-session-list">
              {sessions.map((s) => {
                const lastMsg = s.messages[s.messages.length - 1];
                const preview = lastMsg?.content?.slice(0, 50) || 'Empty session';
                const isActive = s.localId === activeLocalId;
                const isSending = sendingMap[s.localId];
                return (
                  <div key={s.localId} className={`chat-session-item${isActive ? ' chat-session-item-active' : ''}`} onClick={() => switchSession(s.localId)}>
                    <div className="chat-session-item-info">
                      <div className="chat-session-item-title">
                        {s.title}
                        {isSending && <span className="chat-session-item-pulse" />}
                      </div>
                      <div className="chat-session-item-preview">{preview}</div>
                    </div>
                    <button className="chat-session-item-close" onClick={(e) => closeSession(s.localId, e)} title="Close session">✕</button>
                  </div>
                );
              })}
            </div>
            <button className="chat-session-new-btn" onClick={newSessionInWindow}>+ New session</button>
          </div>
        </>
      )}

      <div className="chat-messages">
        {messages.length === 0 && !activeSending && (
          <div className="chat-empty">
            {connected === false ? 'Cannot reach Hermes API\nEnsure api_server is enabled in hermes config' : connected ? `Say hi to ${nickname} ✨` : 'Connecting...'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}${m.isError ? ' chat-msg-error' : ''}`} onDoubleClick={() => setFocusedIndex(i)}>
            {m.role === 'assistant' && m.tools && m.tools.length > 0 && i > 0 && <div className="chat-tool-separator" />}
            <MessageContent content={m.content} tools={m.tools} image={m.image} />
          </div>
        ))}
        {(activeStreaming.content || activeStreaming.tools.length > 0) && (
          <div className="chat-streaming">
            {activeStreaming.tools.length > 0 && messages.length > 0 && <div className="chat-tool-separator" />}
            <MessageContent content={activeStreaming.content} tools={activeStreaming.tools} isStreaming />
          </div>
        )}
        {activeSending && !activeStreaming.content && activeStreaming.tools.length === 0 && (
          <div className="chat-thinking">
            <div className="chat-thinking-bar"><span /><span /><span /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {focusedIndex !== null && messages[focusedIndex] && (
        <div className="chat-focus-overlay" onClick={() => setFocusedIndex(null)}>
          <div className="chat-focus-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chat-focus-modal-header">
              <span className="chat-focus-modal-label">{messages[focusedIndex].role === 'user' ? 'You' : nickname}</span>
              <button className="chat-btn" onClick={() => setFocusedIndex(null)} title="Close (Esc)">✕</button>
            </div>
            <div className="chat-focus-modal-body">
              <div className={`chat-focus-bubble chat-focus-bubble-${messages[focusedIndex].role}`}>
                <MessageContent content={messages[focusedIndex].content} tools={messages[focusedIndex].tools} image={messages[focusedIndex].image} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="chat-input-area">
        <textarea ref={textareaRef} className="chat-textarea" value={input} onChange={onInputChange} onKeyDown={onKeyDown} placeholder={connected === false ? 'Not connected' : `Message ${nickname}…`} disabled={connected === false} rows={1} />
        <div className="chat-input-toolbar">
          <div className="chat-input-actions">
            {models.length > 1 && (
              <div className="chat-model-select-wrapper">
                <span className="chat-dot chat-dot-model" style={{ background: dotColor }} />
                <select className="chat-model-select" value={currentModel} onChange={onModelChange} title="Switch model">
                  {models.map((m) => (<option key={m} value={m}>{m}</option>))}
                </select>
              </div>
            )}
            {models.length <= 1 && <span className="chat-dot chat-dot-model" style={{ background: dotColor }} />}
          </div>
          <div className="chat-context-bar">
            <svg viewBox="0 0 36 36" className="chat-context-svg">
              <path className="chat-context-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path className={`chat-context-fill${contextPct >= 90 ? ' critical' : contextPct >= 75 ? ' danger' : contextPct >= 50 ? ' warn' : ''}`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" strokeDasharray={`${Math.max(0, Math.min(100, contextPct))}, 100`} />
            </svg>
            <span className="chat-context-text">{Math.round(contextPct)}%</span>
          </div>
          <button className={activeSending ? 'chat-action-btn chat-stop-btn' : 'chat-action-btn chat-send-btn'} onClick={activeSending ? stop : send} disabled={!activeSending && (connected === false || !input.trim())} title={activeSending ? 'Stop' : 'Send'}>
            {activeSending ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
            )}
          </button>
        </div>
      </div>

      {cropperSrc && <AvatarCropper imageSrc={cropperSrc} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<ChatApp />);
