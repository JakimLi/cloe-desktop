// ==================== Voice Engine — sherpa-onnx (Streaming/Online) ====================
// Real-time streaming ASR using sherpa-onnx Node.js N-API addon.
// Audio PCM chunks → acceptWaveform → decode → getResult (streaming results).

const fs = require('fs');
const path = require('path');
const { getModel, getModelDir } = require('./model-manager');

class SherpaEngine {
  constructor() {
    this._sherpa = null;
    this._recognizer = null;
    this._stream = null;
    this._ready = false;
    this._listening = false;
    this._modelId = null;
  }

  // ── Load sherpa-onnx native addon ──
  async initialize() {
    try {
      this._sherpa = require('sherpa-onnx');
      this._ready = true;
      return true;
    } catch (err) {
      console.warn('[Voice] sherpa-onnx native addon not available:', err.message);
      this._ready = false;
      return false;
    }
  }

  // ── Set model and create recognizer ──
  setModel(modelId) {
    const model = getModel(modelId);
    if (!model || model.engine !== 'sherpa') {
      throw new Error(`Invalid sherpa model: ${modelId}`);
    }

    const modelDir = getModelDir(modelId);
    if (!fs.existsSync(modelDir)) {
      throw new Error(`Model not downloaded: ${modelId}`);
    }

    this._modelId = modelId;

    // Build sherpa-onnx OnlineRecognizer config
    const config = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80,
      },
      modelConfig: {
        transducer: {
          encoder: path.join(modelDir, model.files[0]), // encoder-*.onnx
          decoder: path.join(modelDir, model.files[1]), // decoder-*.onnx
          joiner: path.join(modelDir, model.files[2]),  // joiner-*.onnx
        },
        tokens: path.join(modelDir, model.files[3]),    // tokens.txt
        numThreads: 4,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
    };

    this._recognizer = this._sherpa.createOnlineRecognizer(config);
    this._stream = this._recognizer.createStream();
  }

  // ── Start a new recognition session ──
  startListening() {
    if (!this._recognizer || !this._stream) {
      throw new Error('Recognizer not initialized');
    }
    // Reset stream for new session
    if (this._stream) {
      this._recognizer.destroyStream(this._stream);
    }
    this._stream = this._recognizer.createStream();
    this._listening = true;
  }

  // ── Feed audio PCM chunk (Float32Array, 16kHz mono) ──
  acceptAudio(samples) {
    if (!this._listening || !this._stream) return null;

    this._recognizer.acceptWaveform(this._stream, 16000, samples);
    this._recognizer.decode(this._stream);

    // Check if we have a partial result
    const isEndpoint = this._recognizer.isEndpoint(this._stream);
    const result = this._recognizer.getResult(this._stream);

    if (isEndpoint) {
      this._recognizer.reset(this._stream);
    }

    return {
      text: result.text || '',
      isFinal: isEndpoint,
    };
  }

  // ── Stop listening and get final result ──
  stopListening() {
    this._listening = false;
    if (this._stream && this._recognizer) {
      // Do one final decode
      this._recognizer.decode(this._stream);
      const result = this._recognizer.getResult(this._stream);
      return result.text || '';
    }
    return '';
  }

  // ── Cleanup ──
  destroy() {
    if (this._stream && this._recognizer) {
      this._recognizer.destroyStream(this._stream);
    }
    this._stream = null;
    this._recognizer = null;
    this._ready = false;
    this._listening = false;
  }

  get isReady() { return this._ready; }
  get isListening() { return this._listening; }
  get name() { return 'Sherpa-ONNX'; }
  get type() { return 'online'; }
}

module.exports = SherpaEngine;
