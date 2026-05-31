// ==================== Voice Engine — Whisper.cpp (Batch/Offline) ====================
// Uses whisper.cpp CLI binary for high-quality offline transcription.
// Audio is captured in renderer → saved as WAV → transcribed by whisper-cli.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getModel, getModelDir, BIN_DIR, ensureDirs } = require('./model-manager');

class WhisperEngine {
  constructor() {
    this._cliPath = null;
    this._modelPath = null;
    this._ready = false;
    this._busy = false;
  }

  // ── Check if whisper-cli binary is available ──
  async initialize() {
    ensureDirs();
    // Look for whisper-cli in BIN_DIR or system PATH
    const localBin = path.join(BIN_DIR, 'whisper-cli');
    const localBinAlt = path.join(BIN_DIR, 'main'); // older whisper.cpp binary name

    if (fs.existsSync(localBin)) {
      this._cliPath = localBin;
    } else if (fs.existsSync(localBinAlt)) {
      this._cliPath = localBinAlt;
    } else {
      // Try system PATH
      try {
        const { execSync } = require('child_process');
        const which = execSync('which whisper-cli 2>/dev/null || which whisper 2>/dev/null', { encoding: 'utf8' }).trim();
        if (which) this._cliPath = which;
      } catch {}
    }

    this._ready = !!this._cliPath;
    return this._ready;
  }

  // ── Set model ──
  setModel(modelId) {
    const model = getModel(modelId);
    if (!model || model.engine !== 'whisper') {
      throw new Error(`Invalid whisper model: ${modelId}`);
    }
    const modelDir = getModelDir(modelId);
    // Find the .bin file in model dir
    const files = fs.readdirSync(modelDir);
    const binFile = files.find(f => f.endsWith('.bin'));
    if (!binFile) throw new Error(`No .bin model file found in ${modelDir}`);
    this._modelPath = path.join(modelDir, binFile);
    this._modelId = modelId;
  }

  // ── Transcribe audio file (WAV/PCM) ──
  async transcribe(audioPath, options = {}) {
    if (!this._cliPath) throw new Error('Whisper CLI not found');
    if (!this._modelPath) throw new Error('No model loaded');
    if (this._busy) throw new Error('Engine busy');

    this._busy = true;
    try {
      const language = options.language || 'auto';
      const args = [
        '-m', this._modelPath,
        '-f', audioPath,
        '--output-txt',
        '--no-timestamps',
        '-l', language,
      ];

      // If using whisper-cli (newer), add --output-file prefix to get just text
      const outDir = path.dirname(audioPath);
      const outBase = path.basename(audioPath, path.extname(audioPath));
      args.push('--output-file', path.join(outDir, outBase));

      return new Promise((resolve, reject) => {
        execFile(this._cliPath, args, {
          timeout: 120000, // 2 min max
          maxBuffer: 10 * 1024 * 1024,
        }, (err, stdout, stderr) => {
          this._busy = false;
          if (err) {
            // whisper-cli returns non-zero sometimes even on success
            // Check if output file was created
          }

          // Read the output .txt file
          const txtPath = audioPath.replace(/\.\w+$/, '.txt');
          try {
            if (fs.existsSync(txtPath)) {
              let text = fs.readFileSync(txtPath, 'utf8').trim();
              // Clean whisper output format: remove [BLANK_AUDIO] etc
              text = text.replace(/\[BLANK_AUDIO\]/g, '').replace(/\[\/?[\w\s]+\]/g, '').trim();
              // Cleanup temp files
              try { fs.unlinkSync(txtPath); } catch {}
              resolve(text || '');
            } else {
              // Sometimes stdout has the text directly
              const text = (stdout || '').trim().replace(/\[BLANK_AUDIO\]/g, '').trim();
              resolve(text || '');
            }
          } catch (readErr) {
            reject(new Error(`Failed to read transcription: ${readErr.message}`));
          }
        });
      });
    } finally {
      this._busy = false;
    }
  }

  get isReady() { return this._ready; }
  get isBusy() { return this._busy; }
  get name() { return 'Whisper.cpp'; }
  get type() { return 'offline'; }
}

module.exports = WhisperEngine;
