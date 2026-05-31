// ==================== Voice Engine — macOS SFSpeechRecognizer (System) ====================
// Zero-download fallback using macOS built-in speech recognition.
// Invokes system `speech` utility or bridges via Swift helper.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class MacOSSpeechEngine {
  constructor() {
    this._ready = false;
    this._busy = false;
  }

  async initialize() {
    // macOS 10.15+ has SFSpeechRecognizer
    // We use a small Swift helper that wraps it
    // For now, check if we're on macOS
    this._ready = process.platform === 'darwin';
    return this._ready;
  }

  // ── Transcribe audio file using macOS speech framework ──
  async transcribe(audioPath, options = {}) {
    if (!this._ready) throw new Error('macOS Speech not available');
    if (this._busy) throw new Error('Engine busy');

    this._busy = true;
    try {
      // Use the macOS `speech` command-line tool if available
      // Otherwise use a Swift helper script
      const swiftHelper = path.join(__dirname, 'macos-speech-helper.swift');

      if (fs.existsSync(swiftHelper)) {
        return await this._transcribeWithHelper(swiftHelper, audioPath, options);
      }

      // Fallback: use whisper.cpp if available, otherwise fail gracefully
      throw new Error('macOS speech helper not installed. Use Whisper or Sherpa engine instead.');
    } finally {
      this._busy = false;
    }
  }

  async _transcribeWithHelper(helperPath, audioPath, options) {
    return new Promise((resolve, reject) => {
      const args = [helperPath, audioPath];
      if (options.language) args.push('-l', options.language);

      execFile('swift', args, {
        timeout: 60000,
        maxBuffer: 5 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`macOS Speech failed: ${err.message}`));
        resolve((stdout || '').trim());
      });
    });
  }

  get isReady() { return this._ready; }
  get isBusy() { return this._busy; }
  get name() { return 'macOS Speech'; }
  get type() { return 'offline'; }
}

module.exports = MacOSSpeechEngine;
