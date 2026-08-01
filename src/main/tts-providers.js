'use strict';

/**
 * TTS Provider Registry — pluggable text-to-speech providers.
 *
 * Each provider is a function: async (text, cfg) → { audio: Buffer, format: 'mp3'|'wav' }
 *
 * Supported providers:
 *   - openai    OpenAI TTS API (tts-1, tts-1-hd). Also works with any OpenAI-compatible
 *               endpoint (Azure OpenAI, proxy services, local servers). Returns MP3 directly.
 *   - mosi      MOSI cloud TTS. Returns WAV (needs ffmpeg → MP3).
 *
 * Adding a new provider:
 *   1. Write an async function matching the signature above.
 *   2. Register it in PROVIDERS below.
 *   3. Done — the bridge POST /tts/generate endpoint picks it up automatically.
 *
 * Config file: ~/.cloe/tts-config.json
 *   {
 *     "provider": "openai",
 *     "openai": {
 *       "api_key": "sk-...",
 *       "base_url": "https://api.openai.com/v1",  // optional, for proxies
 *       "model": "tts-1",
 *       "voice": "alloy",
 *       "instructions": "Speak in a warm, friendly tone"  // optional, for gpt-4o-tts
 *     },
 *     "mosi": {
 *       "api_key": "...",
 *       "voice_id": "...",
 *       "url": "https://studio.mosi.cn/v1/audio/tts"
 *     }
 *   }
 */

const https = require('https');
const http = require('http');

// ── OpenAI-compatible TTS ──
// Works with: OpenAI, Azure OpenAI, OpenRouter, local Ollama/vLLM, any service
// that implements POST /v1/audio/speech → MP3 audio stream.
async function openai(text, cfg) {
  const baseUrl = (cfg.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.model || 'tts-1';
  const voice = cfg.voice || 'alloy';

  const payload = JSON.stringify({
    model,
    input: text,
    voice,
    ...(cfg.instructions ? { instructions: cfg.instructions } : {}),
    response_format: 'mp3',
  });

  const url = new URL(baseUrl + '/audio/speech');
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.api_key}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 20000,
  };

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(options, (resp) => {
      if (resp.statusCode !== 200) {
        let body = '';
        resp.on('data', (c) => body += c);
        resp.on('end', () => reject(new Error(`OpenAI TTS HTTP ${resp.statusCode}: ${body.slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve({ audio: Buffer.concat(chunks), format: 'mp3' }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI TTS request timed out')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── MOSI TTS ──
async function mosi(text, cfg) {
  const payload = JSON.stringify({
    model: 'moss-tts',
    text,
    voice_id: cfg.voice_id,
    sampling_params: { temperature: 1.7, top_p: 0.8, top_k: 25 },
  });

  const url = new URL(cfg.url);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.api_key}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
    timeout: 20000,
  };

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(options, (resp) => {
      let body = '';
      resp.on('data', (c) => body += c);
      resp.on('end', () => {
        try {
          const result = JSON.parse(body);
          const audioB64 = result.audio_data;
          if (!audioB64) return reject(new Error('MOSI returned no audio_data'));
          resolve({ audio: Buffer.from(audioB64, 'base64'), format: 'wav' });
        } catch (e) {
          reject(new Error('MOSI response parse error: ' + e.message));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('MOSI request timed out')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Provider registry ──
const PROVIDERS = {
  openai,
  mosi,
};

module.exports = { PROVIDERS };
