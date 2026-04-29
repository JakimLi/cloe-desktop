// ==================== Cloe Desktop — Renderer (GIF Mode) ====================

// ==================== Config ====================
const WS_PORT = 19850;
const CROSSFADE_MS = 300;
const IDLE_INTERVAL = { min: 8000, max: 15000 };
const REACTION_DURATION = 3000;

// Resolve base path for assets (GIFs, audio)
// Dev mode: Vite serves from http://localhost:5173/ → use /gifs/
// Production: file:// protocol → use relative ./gifs/
const BASE = (location.protocol === 'file:') ? './' : '/';

const GIF_ANIMATIONS = {
  blink:       `${BASE}gifs/blink.gif`,
  smile:       `${BASE}gifs/smile.gif`,
  kiss:        `${BASE}gifs/kiss.gif`,
  nod:         `${BASE}gifs/nod.gif`,
  wave:        `${BASE}gifs/wave.gif`,
  think:       `${BASE}gifs/think.gif`,
  tease:       `${BASE}gifs/tease.gif`,
  speak:       `${BASE}gifs/speak.gif`,
  shake_head:  `${BASE}gifs/shake_head.gif`,
  working:     `${BASE}gifs/working.gif`,
};

// Weighted idle playlist (blink & smile most frequent)
const IDLE_PLAYLIST = ['blink', 'blink', 'smile', 'smile', 'kiss', 'think', 'nod', 'shake_head'];

// Action name → GIF name mapping (1:1 pass-through)
const ACTION_MAP = {
  smile: 'smile', approve: 'smile', happy: 'smile',
  nod: 'nod', wave: 'wave', think: 'think', tease: 'tease',
  kiss: 'kiss', shake_head: 'shake_head', speak: 'speak',
};

// ==================== State ====================
let currentGif = 'blink';
let activeLayer = 'a';
let isTransitioning = false;
let isReacting = false;
let isWorking = false;      // True = locked in working mode (no idle)
let pendingGif = null;
let idleTimer = null;
let reactionTimer = null;

// ==================== DOM ====================
const gifLayerA = document.getElementById('cloe-gif-a');
const gifLayerB = document.getElementById('cloe-gif-b');
const wsStatus = document.getElementById('ws-status');

function getActive()  { return activeLayer === 'a' ? gifLayerA : gifLayerB; }
function getHidden()  { return activeLayer === 'a' ? gifLayerB : gifLayerA; }
function swapLayers() { activeLayer = activeLayer === 'a' ? 'b' : 'a'; }

// ==================== GIF Switch (double-buffer crossfade) ====================
function preloadGif(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

function switchGif(name, autoReturn = true) {
  const src = GIF_ANIMATIONS[name];
  if (!src) return;

  const active = getActive();

  // Already showing — skip but keep scheduling
  if (active.src.endsWith(src.split('/').pop())) {
    if (!autoReturn) scheduleNextIdle();
    return;
  }

  // Queue if mid-transition
  if (isTransitioning) {
    pendingGif = { name, autoReturn };
    return;
  }

  isTransitioning = true;
  const next = getHidden();

  preloadGif(src).then(() => {
    next.src = src;
    next.style.opacity = '1';
    active.style.opacity = '0';
    swapLayers();
    currentGif = name;

    setTimeout(() => {
      isTransitioning = false;

      // Drain queue first
      if (pendingGif) {
        const queued = pendingGif;
        pendingGif = null;
        switchGif(queued.name, queued.autoReturn);
        return;
      }

      if (autoReturn) {
        // In working mode, return to working.gif after reaction
        if (isWorking) {
          isReacting = true;
          reactionTimer = setTimeout(() => {
            isReacting = false;
            stopAudio();
            switchGif('working', false);
          }, REACTION_DURATION);
          return;
        }

        isReacting = true;
        reactionTimer = setTimeout(() => {
          isReacting = false;
          stopAudio();
          startIdleLoop();
        }, REACTION_DURATION);
      } else {
        scheduleNextIdle();
      }
    }, CROSSFADE_MS);
  }).catch((err) => {
    console.error(`[switchGif] ${name}: ${err.message}`);
    isTransitioning = false;
  });
}

function resetGif() {
  const active = getActive();
  const src = active.src;
  active.src = '';
  active.src = src;
}

// ==================== Idle Loop ====================
function scheduleNextIdle() {
  clearTimeout(idleTimer);
  if (isReacting || isWorking) return;
  const delay = IDLE_INTERVAL.min + Math.random() * (IDLE_INTERVAL.max - IDLE_INTERVAL.min);
  idleTimer = setTimeout(playRandomIdle, delay);
}

function playRandomIdle() {
  if (isReacting || isWorking) return;
  const choices = IDLE_PLAYLIST.filter((n) => n !== currentGif);
  const pool = choices.length > 0 ? choices : IDLE_PLAYLIST;
  const next = pool[Math.floor(Math.random() * pool.length)];
  switchGif(next, false);
}

function startIdleLoop() {
  const first = IDLE_PLAYLIST[Math.floor(Math.random() * IDLE_PLAYLIST.length)];
  switchGif(first, false);
}

// ==================== Audio ====================
// --- Streaming TTS Audio (AudioContext) ---
const TTS_WS_PORT = 19853;
let ttsWs = null;
let ttsAudioCtx = null;
let ttsGainNode = null;
let ttsIsPlaying = false;

// Buffer all chunks, play on done (CPU is too slow for real-time streaming)
let ttsChunks = [];       // collected Float32Array chunks
let ttsTotalSamples = 0;
let ttsPrevWorking = false; // remember if we were in working mode before speak

function ensureTtsAudioCtx() {
  if (!ttsAudioCtx) {
    ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    ttsGainNode = ttsAudioCtx.createGain();
    ttsGainNode.gain.value = 0.9;
    ttsGainNode.connect(ttsAudioCtx.destination);
  }
  if (ttsAudioCtx.state === 'suspended') ttsAudioCtx.resume();
}

function connectTtsWebSocket() {
  if (ttsWs && ttsWs.readyState <= 1) return;

  ensureTtsAudioCtx();
  ttsWs = new WebSocket(`ws://127.0.0.1:${TTS_WS_PORT}`);

  ttsWs.onopen = () => {
    console.log('[TTS WS] Connected');
  };

  ttsWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'meta') {
        // New synthesis — reset buffer, snapshot previous state
        ttsChunks = [];
        ttsTotalSamples = 0;
        ttsPrevWorking = isWorking;
        ttsIsPlaying = true;
        console.log(`[TTS WS] Meta: ${msg.sample_rate}Hz, ${msg.channels}ch — buffering...`);
      }
      else if (msg.type === 'audio') {
        // Decode base64 PCM float32 (interleaved stereo) and buffer
        const pcmBytes = atob(msg.data);
        const buf = new ArrayBuffer(pcmBytes.length);
        const uint8 = new Uint8Array(buf);
        for (let i = 0; i < pcmBytes.length; i++) uint8[i] = pcmBytes.charCodeAt(i);
        const pcmArray = new Float32Array(buf);
        ttsChunks.push(pcmArray);
        ttsTotalSamples += pcmArray.length / 2; // samples per channel
        console.log(`[TTS WS] Buffered chunk, total: ${ttsTotalSamples} samples (${(ttsTotalSamples/48000).toFixed(2)}s)`);
      }
      else if (msg.type === 'done') {
        // All chunks received — assemble and play
        if (ttsTotalSamples > 0) {
          const buffer = ttsAudioCtx.createBuffer(2, ttsTotalSamples, 48000);
          const left = buffer.getChannelData(0);
          const right = buffer.getChannelData(1);
          let offset = 0;
          for (const pcm of ttsChunks) {
            const samplesPerChannel = pcm.length / 2;
            for (let i = 0; i < samplesPerChannel; i++) {
              left[offset + i] = pcm[i * 2];
              right[offset + i] = pcm[i * 2 + 1];
            }
            offset += samplesPerChannel;
          }

          // Switch to speak.gif RIGHT when audio starts
          switchGif('speak', false);

          const source = ttsAudioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(ttsGainNode);
          source.start(0);
          source.onended = () => {
            ttsIsPlaying = false;
            isReacting = false;
            clearTimeout(reactionTimer);
            // Restore previous state
            if (ttsPrevWorking) {
              switchGif('working', false);
            } else {
              startIdleLoop();
            }
          };
          console.log(`[TTS WS] Playing ${ttsTotalSamples} samples (${(ttsTotalSamples/48000).toFixed(2)}s)`);
        } else {
          ttsIsPlaying = false;
          isReacting = false;
          if (ttsPrevWorking) {
            switchGif('working', false);
          } else {
            startIdleLoop();
          }
        }
        ttsChunks = [];
        console.log('[TTS WS] Synthesis complete');
      }
      else if (msg.type === 'error') {
        console.error('[TTS WS] Error:', msg.message);
        ttsIsPlaying = false;
        ttsChunks = [];
        isReacting = false;
        startIdleLoop();
      }
    } catch (e) {
      console.error('[TTS WS] Parse error:', e);
    }
  };

  ttsWs.onclose = () => {
    console.log('[TTS WS] Disconnected');
    ttsWs = null;
    setTimeout(connectTtsWebSocket, 5000);
  };

  ttsWs.onerror = () => {
    console.error('[TTS WS] Error');
    ttsWs.close();
  };
}

function ttsSpeak(text) {
  if (!ttsWs || ttsWs.readyState !== 1) {
    console.warn('[TTS] WebSocket not connected, falling back...');
    switchGif('speak');
    return;
  }
  stopAudio();
  // Clear all timers to prevent previous idle/reaction from interrupting
  clearTimeout(idleTimer);
  clearTimeout(reactionTimer);
  isReacting = true; // block idle during buffering + playback
  // Don't switch GIF yet — wait until audio is ready to play
  ttsPrevWorking = isWorking;
  console.log('[TTS] Sending text to TTS server:', text);
  ttsWs.send(JSON.stringify({ text }));
}

// --- Legacy Audio (non-streaming, for pre-recorded and HTTP audio) ---
function playAudio(source, onEnded) {
  stopAudio();
  // Support: data URL (data:audio/...;base64,...), full URL, or pre-recorded name
  let src;
  if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://')) {
    src = source;
  } else {
    src = `${BASE}audio/${source}.mp3`;
  }
  const audio = new Audio(src);
  audio.volume = 0.9;
  window._currentAudio = audio;
  audio.play().catch((e) => console.error('Audio error:', e));
  audio.addEventListener('ended', () => {
    window._currentAudio = null;
    if (onEnded) onEnded();
  });
  // Also handle load error — don't get stuck if audio fails
  audio.addEventListener('error', () => {
    console.error('[Audio] Failed to load:', src.substring(0, 80));
    window._currentAudio = null;
    if (onEnded) onEnded();
  });
  return audio;
}

function stopAudio() {
  if (window._currentAudio) {
    window._currentAudio.pause();
    window._currentAudio = null;
  }
}

// ==================== Action Dispatch ====================
function handleAction(data) {
  const action = data.action;
  console.log('[Action]', action, data);

  // ── Working mode: lock into working GIF until "idle" action ──
  if (action === 'working') {
    clearTimeout(idleTimer);
    clearTimeout(reactionTimer);
    isWorking = true;
    isReacting = false;
    // Use working.gif as default working animation, allow override
    const gifName = data.gif || 'working';
    switchGif(gifName);
    return;
  }

  // ── Exit working mode, resume idle loop ──
  if (action === 'idle') {
    isWorking = false;
    isReacting = false;
    clearTimeout(reactionTimer);
    stopAudio();
    startIdleLoop();
    return;
  }

  // Interrupt idle
  clearTimeout(idleTimer);
  isReacting = true;

  // Handle compound action (expression with sub-type)
  if (action === 'expression') {
    if (data.expression === 'happy' || data.expression === 'smile') {
      switchGif('smile');
    } else {
      resetGif();
    }
    return;
  }

  // Direct mapping or fallback
  const gifName = ACTION_MAP[action];
  if (gifName) {
    if (action === 'speak') {
      // Priority 1: Streaming TTS via WebSocket (text field)
      if (data.text) {
        ttsSpeak(data.text);
      }
      // Priority 2: Dynamic TTS via HTTP (audio_url field, legacy)
      else if (data.audio_url) {
        switchGif(gifName, false);
        playAudio(data.audio_url, () => {
          isReacting = false;
          startIdleLoop();
        });
      }
      // Priority 3: Pre-recorded audio (audio field)
      else {
        switchGif(gifName);
        if (data.audio) {
          playAudio(data.audio);
        }
      }
    } else {
      switchGif(gifName);
    }
  } else {
    resetGif();
  }
}

// ==================== Window Drag ====================
const container = document.getElementById('gif-container');
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

container.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  window.electronAPI?.moveWindow(e.screenX - dragStartX, e.screenY - dragStartY);
  dragStartX = e.screenX;
  dragStartY = e.screenY;
});

window.addEventListener('mouseup', () => { isDragging = false; });

// ==================== WebSocket ====================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

    ws.onopen = () => {
      wsStatus.style.color = '#4CAF50';
    };

    ws.onmessage = (event) => {
      try { handleAction(JSON.parse(event.data)); }
      catch (e) { console.error('WS parse:', e); }
    };

    ws.onclose = () => {
      wsStatus.style.color = '#f44336';
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => ws.close();
  } catch (e) {
    console.error('WS init:', e);
    wsStatus.style.color = '#f44336';
    reconnectTimer = setTimeout(connectWebSocket, 5000);
  }
}

// ==================== Init ====================
startIdleLoop();
connectWebSocket();
connectTtsWebSocket();  // Connect to TTS streaming server
