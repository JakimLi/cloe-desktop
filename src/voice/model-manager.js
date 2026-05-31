// ==================== Voice Model Manager ====================
// Manages local ASR models: list, download (via HuggingFace), delete.
// Models stored in ~/.cloe/voice-models/

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const MODELS_DIR = path.join(os.homedir(), '.cloe', 'voice-models');
const BIN_DIR = path.join(os.homedir(), '.cloe', 'voice-bin');

// ── Model Registry ────────────────────────────────────────────
// Each model has: id, name, engine ('sherpa' | 'whisper'), size (bytes),
// sizeLabel, urls (files to download), languages, type ('online' | 'offline')

const MODEL_REGISTRY = {
  // ── sherpa-onnx streaming models ──
  'sherpa-zipformer-bilingual-zh-en': {
    id: 'sherpa-zipformer-bilingual-zh-en',
    name: '中英双语流式 (Zipformer)',
    engine: 'sherpa',
    size: 200 * 1024 * 1024,
    sizeLabel: '~200MB',
    languages: ['zh', 'en'],
    type: 'online',
    urls: [
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-bilingual-zh-en.tar.bz2',
    ],
    // After extraction, these files are needed:
    extractSubdir: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-bilingual-zh-en',
    files: [
      'encoder-epoch-99-avg-1.onnx',
      'decoder-epoch-99-avg-1.onnx',
      'joiner-epoch-99-avg-1.onnx',
      'tokens.txt',
    ],
  },
  'sherpa-zipformer-en': {
    id: 'sherpa-zipformer-en',
    name: '英文流式 (Zipformer)',
    engine: 'sherpa',
    size: 100 * 1024 * 1024,
    sizeLabel: '~100MB',
    languages: ['en'],
    type: 'online',
    urls: [
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2',
    ],
    extractSubdir: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
    files: [
      'encoder-epoch-99-avg-1.onnx',
      'decoder-epoch-99-avg-1.onnx',
      'joiner-epoch-99-avg-1.onnx',
      'tokens.txt',
    ],
  },

  // ── Whisper batch models (GGML format for whisper.cpp) ──
  'whisper-tiny': {
    id: 'whisper-tiny',
    name: 'Whisper Tiny',
    engine: 'whisper',
    size: 75 * 1024 * 1024,
    sizeLabel: '~75MB',
    languages: ['multilingual'],
    type: 'offline',
    urls: [
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    ],
    files: ['ggml-tiny.bin'],
  },
  'whisper-base': {
    id: 'whisper-base',
    name: 'Whisper Base',
    engine: 'whisper',
    size: 150 * 1024 * 1024,
    sizeLabel: '~150MB',
    languages: ['multilingual'],
    type: 'offline',
    urls: [
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    ],
    files: ['ggml-base.bin'],
  },
  'whisper-small': {
    id: 'whisper-small',
    name: 'Whisper Small',
    engine: 'whisper',
    size: 500 * 1024 * 1024,
    sizeLabel: '~500MB',
    languages: ['multilingual'],
    type: 'offline',
    urls: [
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    ],
    files: ['ggml-small.bin'],
  },
  'whisper-medium': {
    id: 'whisper-medium',
    name: 'Whisper Medium',
    engine: 'whisper',
    size: 1536 * 1024 * 1024,
    sizeLabel: '~1.5GB',
    languages: ['multilingual'],
    type: 'offline',
    urls: [
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    ],
    files: ['ggml-medium.bin'],
  },
  'whisper-large-v3-turbo': {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large V3 Turbo',
    engine: 'whisper',
    size: 1536 * 1024 * 1024,
    sizeLabel: '~1.5GB',
    languages: ['multilingual'],
    type: 'offline',
    urls: [
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
    ],
    files: ['ggml-large-v3-turbo.bin'],
  },
};

function ensureDirs() {
  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
}

// ── List available models (registry + download status) ──
function listModels() {
  ensureDirs();
  const result = [];
  for (const [id, model] of Object.entries(MODEL_REGISTRY)) {
    const modelDir = path.join(MODELS_DIR, id);
    const downloaded = fs.existsSync(modelDir) && model.files.every(f => fs.existsSync(path.join(modelDir, f)));
    const diskSize = downloaded ? getDirSize(modelDir) : 0;
    result.push({
      ...model,
      downloaded,
      diskSize,
    });
  }
  return result;
}

// ── Get model by id ──
function getModel(modelId) {
  return MODEL_REGISTRY[modelId] || null;
}

// ── Get model directory path ──
function getModelDir(modelId) {
  return path.join(MODELS_DIR, modelId);
}

// ── Delete a downloaded model ──
function deleteModel(modelId) {
  const modelDir = path.join(MODELS_DIR, modelId);
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

// ── Download a model (returns progress via onProgress callback) ──
async function downloadModel(modelId, onProgress) {
  const model = MODEL_REGISTRY[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);

  ensureDirs();
  const modelDir = path.join(MODELS_DIR, modelId);
  if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });

  if (model.engine === 'whisper') {
    // Direct file download
    for (const url of model.urls) {
      const filename = url.split('/').pop();
      const destPath = path.join(modelDir, filename);
      if (fs.existsSync(destPath)) continue; // already downloaded
      await downloadFile(url, destPath, onProgress);
    }
  } else if (model.engine === 'sherpa') {
    // Download tar.bz2 and extract
    const archiveName = model.urls[0].split('/').pop();
    const archivePath = path.join(modelDir, archiveName);

    if (!fs.existsSync(archivePath)) {
      await downloadFile(model.urls[0], archivePath, onProgress);
    }

    // Extract
    onProgress?.({ stage: 'extracting', modelId, progress: -1 });
    try {
      execSync(`cd "${modelDir}" && tar xjf "${archiveName}"`, { stdio: 'pipe' });

      // Move files from extract subdir to model dir
      if (model.extractSubdir) {
        const extractedDir = path.join(modelDir, model.extractSubdir);
        if (fs.existsSync(extractedDir)) {
          for (const f of model.files) {
            const src = path.join(extractedDir, f);
            const dst = path.join(modelDir, f);
            if (fs.existsSync(src) && !fs.existsSync(dst)) {
              fs.renameSync(src, dst);
            }
          }
          // Cleanup extraction directory
          fs.rmSync(extractedDir, { recursive: true, force: true });
        }
      }

      // Cleanup archive
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    } catch (err) {
      throw new Error(`Extraction failed: ${err.message}`);
    }
  }

  onProgress?.({ stage: 'done', modelId });
  return true;
}

// ── Download file with progress ──
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let downloadedBytes = 0;
    let totalBytes = 0;

    function followRedirect(currentUrl, redirectCount) {
      if (redirectCount > 10) return reject(new Error('Too many redirects'));

      const mod = currentUrl.startsWith('https') ? https : require('http');
      const req = mod.get(currentUrl, { timeout: 30000 }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return followRedirect(res.headers.location, redirectCount + 1);
        }
        if (res.statusCode !== 200) {
          try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let lastProgress = 0;

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const progress = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : -1;
          // Throttle progress callbacks to ~4/sec
          const now = Date.now();
          if (now - lastProgress > 250 || progress === 100) {
            lastProgress = now;
            onProgress?.({
              stage: 'downloading',
              progress,
              downloadedBytes,
              totalBytes,
            });
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      });

      req.on('error', (err) => {
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
        reject(new Error('Download timeout'));
      });
    }

    followRedirect(url, 0);
  });
}

// ── Get voice config ──
function getVoiceConfig() {
  const configPath = path.join(os.homedir(), '.cloe', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return cfg.voice || {};
    }
  } catch {}
  return {};
}

function saveVoiceConfig(voiceCfg) {
  const configPath = path.join(os.homedir(), '.cloe', 'config.json');
  let cfg = {};
  try {
    if (fs.existsSync(configPath)) cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {}
  cfg.voice = { ...cfg.voice, ...voiceCfg };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

// ── Utility: get directory size ──
function getDirSize(dirPath) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        size += fs.statSync(full).size;
      } else if (entry.isDirectory()) {
        size += getDirSize(full);
      }
    }
  } catch {}
  return size;
}

module.exports = {
  MODEL_REGISTRY,
  MODELS_DIR,
  BIN_DIR,
  listModels,
  getModel,
  getModelDir,
  deleteModel,
  downloadModel,
  getVoiceConfig,
  saveVoiceConfig,
  ensureDirs,
};
