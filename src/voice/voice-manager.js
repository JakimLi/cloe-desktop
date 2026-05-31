// ==================== Voice Engine Manager ====================
// Unified entry point for voice recognition.
// Manages engine lifecycle, model loading, and audio processing.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getVoiceConfig, saveVoiceConfig, getModel, getModelDir } = require('./model-manager');
const WhisperEngine = require('./whisper-engine');
const SherpaEngine = require('./sherpa-engine');
const MacOSSpeechEngine = require('./macos-engine');

const VOICE_MODELS_DIR = path.join(os.homedir(), '.cloe', 'voice-models');

class VoiceEngineManager {
  constructor() {
    this._engines = {
      whisper: new WhisperEngine(),
      sherpa: new SherpaEngine(),
      macos: new MacOSSpeechEngine(),
    };
    this._activeEngine = null;
    this._activeModelId = null;
    this._recording = false;
    this._audioChunks = [];
    this._initialized = false;
  }

  // ── Initialize all available engines ──
  async initialize() {
    if (this._initialized) return;

    const results = {};
    for (const [name, engine] of Object.entries(this._engines)) {
      try {
        results[name] = await engine.initialize();
      } catch (err) {
        results[name] = false;
      }
    }
    this._initialized = true;

    // Auto-load saved config
    const cfg = getVoiceConfig();
    if (cfg.engine && cfg.model && results[cfg.engine]) {
      try {
        await this.loadEngine(cfg.engine, cfg.model);
      } catch {}
    }

    return results;
  }

  // ── Load a specific engine + model ──
  async loadEngine(engineName, modelId) {
    const engine = this._engines[engineName];
    if (!engine) throw new Error(`Unknown engine: ${engineName}`);
    if (!engine.isReady) throw new Error(`Engine ${engineName} not available`);

    if (engineName === 'sherpa') {
      engine.setModel(modelId);
    } else if (engineName === 'whisper') {
      engine.setModel(modelId);
    }

    this._activeEngine = engineName;
    this._activeModelId = modelId;

    // Save config
    saveVoiceConfig({ engine: engineName, model: modelId });

    return true;
  }

  // ── Start recording (for streaming engines) ──
  startRecording() {
    if (this._recording) return;
    if (!this._activeEngine) {
      throw new Error('NO_ENGINE: 请先在设置中选择语音识别引擎并下载模型');
    }
    this._recording = true;
    this._audioChunks = [];

    if (this._activeEngine === 'sherpa') {
      this._engines.sherpa.startListening();
    }
  }

  // ── Feed audio chunk during recording ──
  feedAudioChunk(pcmData) {
    if (!this._recording) return null;

    this._audioChunks.push(pcmData);

    if (this._activeEngine === 'sherpa' && this._engines.sherpa.isListening) {
      return this._engines.sherpa.acceptAudio(pcmData);
    }

    return null;
  }

  // ── Stop recording, return transcription ──
  async stopRecording() {
    if (!this._recording) return '';
    this._recording = false;

    if (!this._activeEngine) {
      return '';
    }

    if (this._activeEngine === 'sherpa') {
      return this._engines.sherpa.stopListening();
    }

    // For offline engines (whisper, macos), save audio to temp file and transcribe
    if (this._activeEngine === 'whisper' || this._activeEngine === 'macos') {
      const wavPath = await this._saveAudioAsWav();
      try {
        const engine = this._engines[this._activeEngine];
        const cfg = getVoiceConfig();
        const result = await engine.transcribe(wavPath, { language: cfg.language || 'auto' });
        return result;
      } finally {
        // Cleanup temp file
        try { fs.unlinkSync(wavPath); } catch {}
      }
    }

    return '';
  }

  // ── Save collected PCM chunks as WAV file ──
  async _saveAudioAsWav() {
    const tmpDir = os.tmpdir();
    const wavPath = path.join(tmpDir, `cloe-voice-${Date.now()}.wav`);

    // Merge all chunks into one Float32Array
    let totalLength = 0;
    for (const chunk of this._audioChunks) {
      totalLength += chunk.length;
    }
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this._audioChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert Float32 → Int16 PCM
    const pcm16 = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Write WAV header + data
    const buffer = Buffer.alloc(44 + pcm16.length * 2);
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + pcm16.length * 2, 4);
    buffer.write('WAVE', 8);
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);       // chunk size
    buffer.writeUInt16LE(1, 20);        // PCM format
    buffer.writeUInt16LE(1, 22);        // mono
    buffer.writeUInt32LE(16000, 24);    // sample rate
    buffer.writeUInt32LE(32000, 28);    // byte rate (16kHz * 2 bytes)
    buffer.writeUInt16LE(2, 32);        // block align
    buffer.writeUInt16LE(16, 34);       // bits per sample
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(pcm16.length * 2, 40);

    // PCM data
    const pcmBuffer = Buffer.from(pcm16.buffer);
    pcmBuffer.copy(buffer, 44);

    fs.writeFileSync(wavPath, buffer);
    return wavPath;
  }

  // ── Get current status ──
  getStatus() {
    return {
      initialized: this._initialized,
      activeEngine: this._activeEngine,
      activeModel: this._activeModelId,
      recording: this._recording,
      engines: Object.fromEntries(
        Object.entries(this._engines).map(([name, engine]) => [name, engine.isReady])
      ),
    };
  }

  // ── Get available engines with their ready status ──
  getAvailableEngines() {
    return Object.entries(this._engines).map(([name, engine]) => ({
      id: name,
      name: engine.name,
      type: engine.type,
      ready: engine.isReady,
    }));
  }

  get isRecording() { return this._recording; }
  get activeEngine() { return this._activeEngine; }
}

// Singleton
let _instance = null;
function getVoiceManager() {
  if (!_instance) {
    _instance = new VoiceEngineManager();
  }
  return _instance;
}

module.exports = { VoiceEngineManager, getVoiceManager };
