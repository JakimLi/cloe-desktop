'use strict';

/**
 * Config — user configuration + data-directory management.
 *
 * Extracted verbatim from launcher.js. All routines here are pure with
 * respect to module state (no globals); they only touch the filesystem and
 * `app`/`screen` from Electron. This is the lowest-risk extraction: dozens of
 * call sites in launcher.js consume loadConfig/saveConfig/getDataDir, and
 * nothing writes back into this module's scope.
 *
 * Path note: this file lives in src/main/, so paths that used to resolve
 * against the project root via launcher.js's __dirname (public/, dist/) are
 * re-rooted through PROJECT_ROOT to stay identical to the original behaviour.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
// Electron is a singleton in the main process — safe to require directly.
const { app, screen } = require('electron');

// Project root = two levels up from src/main/
const PROJECT_ROOT = path.join(__dirname, '..', '..');

// ==================== User config (~/.cloe/config.json) ====================

function getCloeConfigDir() {
  return path.join(os.homedir(), '.cloe');
}

function getConfigPath() {
  return path.join(getCloeConfigDir(), 'config.json');
}

function expandDataDir(raw) {
  const def = path.join(os.homedir(), '.cloe');
  const s = raw != null && String(raw).trim() !== '' ? String(raw).trim() : '~/.cloe';
  if (s.startsWith('~/')) return path.normalize(path.join(os.homedir(), s.slice(2)));
  if (s === '~') return os.homedir();
  if (path.isAbsolute(s)) return path.normalize(s);
  return path.normalize(path.join(os.homedir(), s));
}

function loadConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Writable data root: packaged → config dataDir; dev → project public/
 */
function getDataDir() {
  if (!app.isPackaged) {
    return path.join(PROJECT_ROOT, 'public');
  }
  const cfg = loadConfig();
  return expandDataDir(cfg.dataDir);
}

function getBundledSeedRoot() {
  return app.isPackaged ? path.join(PROJECT_ROOT, 'dist') : path.join(PROJECT_ROOT, 'public');
}

function copyTreeMissingOnly(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyTreeMissingOnly(s, d);
    } else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
    }
  }
}

function copyTreeOverwrite(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyTreeOverwrite(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function ensureCloeConfigDirAndMigrateConfig() {
  const cloeDir = getCloeConfigDir();
  if (!fs.existsSync(cloeDir)) {
    fs.mkdirSync(cloeDir, { recursive: true });
  }
  const cfgPath = getConfigPath();
  if (!fs.existsSync(cfgPath)) {
    const merged = {
      version: 1,
      dataDir: '~/.cloe',
      videoModel: 'wan2.7-i2v',
      language: 'zh-CN',
    };
    const legacyDesktop = path.join(os.homedir(), '.cloe-desktop', 'config.json');
    if (fs.existsSync(legacyDesktop)) {
      try {
        const old = JSON.parse(fs.readFileSync(legacyDesktop, 'utf-8'));
        if (old.dashscopeApiKey != null) merged.dashscopeApiKey = old.dashscopeApiKey;
        if (old.videoModel != null) merged.videoModel = old.videoModel;
        if (old.language != null) merged.language = old.language;
        if (old.dataDir != null && String(old.dataDir).trim() !== '') merged.dataDir = old.dataDir;
        console.log('[Config] Migrated keys from ~/.cloe-desktop/config.json');
      } catch (err) {
        console.warn('[Config] Legacy ~/.cloe-desktop/config.json unreadable:', err.message);
      }
    }
    saveConfig(merged);
  } else {
    const cfg = loadConfig();
    let changed = false;
    if (cfg.dataDir == null || String(cfg.dataDir).trim() === '') {
      cfg.dataDir = '~/.cloe';
      changed = true;
    }
    if (cfg.version == null) {
      cfg.version = 1;
      changed = true;
    }
    if (changed) saveConfig(cfg);
  }

  const legacyPath = path.join(os.homedir(), '.cloe-desktop', 'config.json');
  const mergeMarker = path.join(cloeDir, '.merged-from-cloe-desktop-config');
  if (fs.existsSync(legacyPath) && !fs.existsSync(mergeMarker)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      const cur = loadConfig();
      let changed = false;
      for (const k of ['dashscopeApiKey', 'videoModel', 'language']) {
        if (old[k] != null && old[k] !== '' && (cur[k] == null || cur[k] === '')) {
          cur[k] = old[k];
          changed = true;
        }
      }
      if (changed) saveConfig(cur);
    } catch (err) {
      console.warn('[Config] Legacy ~/.cloe-desktop merge failed:', err.message);
    }
    fs.writeFileSync(mergeMarker, `${new Date().toISOString()}\n`);
  }
}

function seedPackagedDataDir(dataDir) {
  const bundledRoot = path.join(PROJECT_ROOT, 'dist');
  if (!fs.existsSync(bundledRoot)) {
    console.warn('[Seed] dist/ not found, skipping seed copy');
    return;
  }
  for (const sub of ['gifs', 'references', 'audio']) {
    copyTreeMissingOnly(path.join(bundledRoot, sub), path.join(dataDir, sub));
  }
  const destJson = path.join(dataDir, 'action-sets.json');
  if (!fs.existsSync(destJson)) {
    const srcJson = path.join(bundledRoot, 'action-sets.json');
    if (fs.existsSync(srcJson)) fs.copyFileSync(srcJson, destJson);
  }
}

function migrateLegacyElectronUserData(dataDir) {
  const marker = path.join(dataDir, '.migrated-from-electron-userdata');
  if (fs.existsSync(marker)) return;

  const legacyBase = app.getPath('userData');
  if (fs.existsSync(legacyBase)) {
    const legacyGifs = path.join(legacyBase, 'gifs');
    const legacyActionSets = path.join(legacyBase, 'action-sets.json');
    if (fs.existsSync(legacyGifs)) {
      copyTreeOverwrite(legacyGifs, path.join(dataDir, 'gifs'));
      console.log('[Migrate] GIFs from', legacyGifs, '→', path.join(dataDir, 'gifs'));
    }
    if (fs.existsSync(legacyActionSets)) {
      fs.copyFileSync(legacyActionSets, path.join(dataDir, 'action-sets.json'));
      console.log('[Migrate] action-sets.json from legacy userData');
    }
  }
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
}

function bootstrapPackagedData() {
  const dataDir = getDataDir();
  for (const sub of ['gifs', 'references', 'audio']) {
    const d = path.join(dataDir, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  seedPackagedDataDir(dataDir);
  migrateLegacyElectronUserData(dataDir);
}

// ==================== Saved main window position ====================

function getWindowPositionFilePath() {
  return path.join(getCloeConfigDir(), 'window-position.json');
}

function loadWindowPosition() {
  const p = getWindowPositionFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (typeof data.x !== 'number' || typeof data.y !== 'number'
      || !Number.isFinite(data.x) || !Number.isFinite(data.y)) {
      return null;
    }
    return { x: Math.round(data.x), y: Math.round(data.y) };
  } catch {
    return null;
  }
}

function saveWindowPosition(x, y) {
  const p = getWindowPositionFilePath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ x: Math.round(x), y: Math.round(y) }), 'utf-8');
}

function clearSavedWindowPosition() {
  const p = getWindowPositionFilePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** Returns { x, y } for the main floating window: saved position if valid, else bottom-right fallback. */
function getInitialMainWindowXY(windowWidth, windowHeight) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const fallback = { x: sw - 400, y: sh - 540 };

  const saved = loadWindowPosition();
  if (!saved) return fallback;

  // 宽松检查：允许窗口部分超出屏幕边缘（macOS 正常行为）
  // 只排除极端异常值（超过屏幕尺寸2倍）
  const maxReasonable = Math.max(sw, sh) * 2;
  if (Math.abs(saved.x) > maxReasonable || Math.abs(saved.y) > maxReasonable) {
    return fallback;
  }

  return saved;
}

module.exports = {
  PROJECT_ROOT,
  getCloeConfigDir,
  getConfigPath,
  expandDataDir,
  loadConfig,
  saveConfig,
  getDataDir,
  getBundledSeedRoot,
  copyTreeMissingOnly,
  copyTreeOverwrite,
  ensureCloeConfigDirAndMigrateConfig,
  seedPackagedDataDir,
  migrateLegacyElectronUserData,
  bootstrapPackagedData,
  getWindowPositionFilePath,
  loadWindowPosition,
  saveWindowPosition,
  clearSavedWindowPosition,
  getInitialMainWindowXY,
};
