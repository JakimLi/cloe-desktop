'use strict';

/**
 * TTS HTTP routes — serve generated TTS audio files.
 *
 *   GET /tts/:filename          stream an audio file from the TTS audio dir,
 *                               with HTTP Range support (206 Partial Content)
 *                               so Chromium can stream MP3s.
 *   GET /tts-fallback/:filename stream a bundled fallback audio file.
 *
 * Extracted verbatim from createBridgeServers. Exports a single dispatcher
 * `register(ctx)` that returns a `(req, res) => boolean` handler; the bridge
 * calls it and stops on a hit (true).
 *
 * Dependencies injected via ctx:
 *   - getTtsAudioDir()                          (gif-generation module)
 *
 * The bundled `audio/fallback` directory lives at the project root; this
 * module sits in src/main/, so we walk up two levels before joining.
 */

module.exports = function register(ctx) {
  const { getTtsAudioDir } = ctx;
  const path = require('path');
  const fs = require('fs');

  return function ttsRoutes(req, res) {
    // GET /tts/:filename — serve audio files from audio_cache directory
    // Used by Hermes TTS pipeline: generate mp3 → save to ~/.cloe/audio_cache/ →
    // trigger speak with audio_url=http://localhost:19851/tts/filename.mp3
    // Supports Range requests (206 Partial Content) — Chromium requires this
    // for MP3 streaming; without it, playback truncates at ~10s.
    if (req.method === 'GET' && req.url.startsWith('/tts-fallback/')) {
      const filename = decodeURIComponent(req.url.slice(14));
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\\0')) {
        res.writeHead(400); res.end('Invalid filename'); return;
      }
      const fbDir = path.join(__dirname, '..', '..', 'audio', 'fallback');
      const filePath = path.join(fbDir, filename);
      if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
      const stat = fs.statSync(filePath);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }

    if (req.method === 'GET' && req.url.startsWith('/tts/')) {
      const filename = decodeURIComponent(req.url.slice(5));
      if (!filename || filename.includes('/') || filename.includes('..') || filename.includes('\0')) {
        res.writeHead(400);
        res.end('Invalid filename');
        return true;
      }
      const ttsDir = getTtsAudioDir();
      const filePath = path.join(ttsDir, filename);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return true;
      }
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.opus': 'audio/opus', '.ogg': 'audio/ogg' };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Parse Range header
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
          if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, {
              'Content-Range': `bytes */${fileSize}`,
            });
            res.end();
            return true;
          }
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Length': chunkSize,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Cache-Control': 'no-cache',
            'Accept-Ranges': 'bytes',
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
          return true;
        }
      }

      // Full response with Accept-Ranges so the client knows Range is supported
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileSize,
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
      return true;
    }

    return false;
  };
};
