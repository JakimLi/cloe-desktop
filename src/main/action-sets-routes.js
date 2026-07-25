'use strict';

/**
 * Action Sets HTTP routes — listing sets, GIF streaming, actions CRUD,
 * and async GIF / reference generation jobs.
 *
 * Extracted verbatim from createBridgeServers. Exports a single dispatcher
 * `register(ctx)` that returns a `(req, res, urlPath) => boolean` handler; the
 * bridge calls it and stops on a hit (true).
 *
 * Routes (in order):
 *   GET    /action-sets                                 list all sets
 *   GET    /action-sets/:id/actions/:name/gif           stream GIF (Range-ready pipe)
 *   GET    /action-sets/:id                             single set with actions
 *   GET    /actions  /  /actions?set=xxx                backward-compatible actions
 *   POST   /actions/preview                             delegate to handleActionPost
 *   GET    /generation-tasks                            list in-memory tasks
 *   GET    /generation-tasks/:taskId                    single task
 *   POST   /action-sets/generate-reference              start reference job
 *   POST   /action-sets/:id/generate-action             start GIF job
 *   POST   /action-sets                                 create set
 *   DELETE /action-sets/:id                             delete set
 *   POST   /action-sets/:id/activate                    activate set
 *   POST   /action-sets/:id/actions                     add action
 *   DELETE /action-sets/:id/actions/:name               delete action
 *   PATCH  /action-sets/:id/idle-playlist               update idle config
 *
 * Dependencies are injected via ctx to avoid coupling to launcher.js globals.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = function register(ctx) {
  const {
    actionSets,
    getActiveSet, getSetById, buildActionsList, buildSetsSummary,
    saveActionSets, isSafeFilename, generateSetId, broadcastSetConfig,
    getSetGifDir, getSetAnimationPath,
    runGifGenerationJob, runReferenceGenerationJob,
    getGenerationTasks,
    getDataDir,
    handleActionPost,
  } = ctx;

  return function actionSetsRoutes(req, res, urlPath) {
    // --- Management API ---
    // GET /action-sets — list all sets
    if (req.method === 'GET' && req.url === '/action-sets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId: actionSets.getActiveSetId() }));
      return true;
    }

    // GET /action-sets/:id/actions/:name/gif — serve GIF binary for Android full-sync
    if (req.method === 'GET' && urlPath.match(/^\/action-sets\/[^/]+\/actions\/[^/]+\/gif$/)) {
      const parts = urlPath.split('/');
      const setId = decodeURIComponent(parts[2]);
      const actionName = decodeURIComponent(parts[4]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      const rel = set.animations?.[actionName];
      if (!rel) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'action not found' }));
        return true;
      }
      const absPath = path.join(getDataDir(), rel);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'gif file not found' }));
        return true;
      }
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': fs.statSync(absPath).size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(absPath).pipe(res);
      return true;
    }

    // GET /action-sets/:id — get one set with its actions
    if (req.method === 'GET' && urlPath.match(/^\/action-sets\/[^/]+$/)) {
      const setId = decodeURIComponent(urlPath.split('/action-sets/')[1]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: set.id,
        name: set.name,
        nameEn: set.nameEn || set.name,
        reference: set.reference,
        chromakey: set.chromakey,
        description: set.description,
        descriptionEn: set.descriptionEn || set.description,
        actions: buildActionsList(setId),
      }));
      return true;
    }

    // GET /actions — backward compatible, returns active set's actions
    if (req.method === 'GET' && req.url === '/actions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(), activeSetId: actionSets.getActiveSetId() }));
      return true;
    }

    // GET /actions?set=xxx — actions for a specific set
    if (req.method === 'GET' && req.url.startsWith('/actions?set=')) {
      const setId = new URL(req.url, 'http://localhost').searchParams.get('set');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(setId), setId }));
      return true;
    }

    if (req.method === 'POST' && req.url === '/actions/preview') {
      handleActionPost(req, res);
      return true;
    }

    // GET /generation-tasks — in-memory GIF / reference generation state
    if (req.method === 'GET' && urlPath === '/generation-tasks') {
      const tasks = [...getGenerationTasks().entries()].map(([taskId, t]) => ({
        taskId,
        status: t.status,
        progress: t.progress ?? 0,
        startedAt: t.startedAt,
        completedAt: t.completedAt ?? null,
        kind: t.kind ?? 'gif',
        actionName: t.actionName ?? undefined,
        setId: t.setId ?? undefined,
        chromakey: t.chromakey ?? undefined,
        error: t.error ?? undefined,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tasks }));
      return true;
    }

    if (req.method === 'GET' && urlPath.startsWith('/generation-tasks/')) {
      const taskId = decodeURIComponent(urlPath.slice('/generation-tasks/'.length));
      const t = getGenerationTasks().get(taskId);
      if (!t) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'task not found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        taskId,
        status: t.status,
        progress: t.progress ?? 0,
        startedAt: t.startedAt,
        completedAt: t.completedAt ?? null,
        kind: t.kind ?? 'gif',
        actionName: t.actionName,
        setId: t.setId,
        chromakey: t.chromakey,
        error: t.error,
      }));
      return true;
    }

    // --- Action Sets CRUD API ---

    // POST /action-sets/generate-reference — async Wanx chroma reference → WS reference-generated
    if (req.method === 'POST' && urlPath === '/action-sets/generate-reference') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const chromakey = data.chromakey === 'blue' ? 'blue' : 'green';
          const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
          const taskId = crypto.randomUUID();
          getGenerationTasks().set(taskId, {
            status: 'pending',
            progress: 0,
            startedAt: Date.now(),
            kind: 'reference',
            chromakey,
          });
          runReferenceGenerationJob(taskId, chromakey, prompt || null, data.imageBase64 || null);
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ taskId, status: 'pending' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    // POST /action-sets/:id/generate-action — async Python GIF pipeline
    const genGifMatch =
      req.method === 'POST' && urlPath.match(/^\/action-sets\/([^/]+)\/generate-action$/);
    if (genGifMatch) {
      const setId = decodeURIComponent(genGifMatch[1]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const name = typeof data.name === 'string' ? data.name.trim() : '';
          const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
          let duration =
            typeof data.duration === 'number' && Number.isFinite(data.duration)
              ? Math.round(data.duration)
              : 5;
          if (duration !== 3 && duration !== 5) duration = 5;

          let chromakey = data.chromakey;
          chromakey = chromakey === 'blue' || chromakey === 'green'
            ? chromakey
            : (set.chromakey === 'blue' ? 'blue' : 'green');

          const trigger = data.trigger === 'idle' ? 'idle' : 'manual';

          if (!name || !/^[a-z][a-z0-9_]{0,63}$/.test(name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name must match [a-z][a-z0-9_]{0,63}' }));
            return;
          }
          if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'prompt is required' }));
            return;
          }
          if (!set.animations) set.animations = {};
          if (set.animations[name]) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'action already exists' }));
            return;
          }

          const taskId = crypto.randomUUID();
          getGenerationTasks().set(taskId, {
            status: 'pending',
            progress: 0,
            startedAt: Date.now(),
            kind: 'gif',
            actionName: name,
            setId,
            chromakey,
          });

          runGifGenerationJob(taskId, setId, set, name, prompt, duration, chromakey, trigger);

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ taskId, status: 'pending' }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    // POST /action-sets — create new action set
    if (req.method === 'POST' && req.url === '/action-sets') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name is required' }));
            return;
          }
          if (!isSafeFilename(data.name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name contains invalid characters (only alphanumeric, underscore, hyphen, Chinese allowed)' }));
            return;
          }
          const id = generateSetId(data.name);
          // Save reference image if provided
          if (data.referenceBase64) {
            const refDir = path.join(getDataDir(), 'references');
            if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });
            fs.writeFileSync(path.join(refDir, `${id}.png`), Buffer.from(data.referenceBase64, 'base64'));
          }
          const newSet = {
            id,
            name: data.name,
            nameEn: data.nameEn || '',
            description: data.description || '',
            descriptionEn: data.descriptionEn || '',
            reference: data.referenceBase64 ? `references/${id}.png` : '',
            chromakey: data.chromakey || 'green',
            animations: {},
            idlePlaylist: [],
            actionMap: {},
          };
          actionSets.getActionSetsData().sets.push(newSet);
          saveActionSets();
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(newSet));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    // DELETE /action-sets/:id — delete action set (must not match /action-sets/:id/actions/...)
    if (req.method === 'DELETE' && req.url.startsWith('/action-sets/') && !req.url.includes('/actions/')) {
      const setId = decodeURIComponent(req.url.split('/action-sets/')[1]?.split('?')[0]);
      if (setId === actionSets.getActiveSetId()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'cannot delete the active set' }));
        return true;
      }
      if (actionSets.getActionSetsData().sets.length <= 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'cannot delete the last set' }));
        return true;
      }
      const idx = actionSets.getActionSetsData().sets.findIndex(s => s.id === setId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      actionSets.getActionSetsData().sets.splice(idx, 1);
      saveActionSets();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sets: buildSetsSummary(), activeSetId: actionSets.getActiveSetId() }));
      return true;
    }

    // POST /action-sets/:id/activate — activate action set
    if (req.method === 'POST' && req.url.match(/^\/action-sets\/[^/]+\/activate$/)) {
      const setId = decodeURIComponent(req.url.split('/')[2]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      actionSets.setActiveSetId(setId);
      saveActionSets();
      broadcastSetConfig(setId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, activeSetId: setId }));
      return true;
    }

    // POST /action-sets/:id/actions — add action to set
    if (req.method === 'POST' && req.url.match(/^\/action-sets\/[^/]+\/actions$/)) {
      const setId = decodeURIComponent(req.url.split('/')[2]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name || !data.gifBase64) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name and gifBase64 are required' }));
            return;
          }
          if (!isSafeFilename(data.name)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name contains invalid characters (only alphanumeric, underscore, hyphen, Chinese allowed)' }));
            return;
          }
          // Save GIF file (namespace per set to avoid overwriting other sets)
          const gifsDir = getSetGifDir(setId);
          if (!fs.existsSync(gifsDir)) fs.mkdirSync(gifsDir, { recursive: true });
          fs.writeFileSync(path.join(gifsDir, `${data.name}.gif`), Buffer.from(data.gifBase64, 'base64'));

          // Update set data
          if (!set.animations) set.animations = {};
          set.animations[data.name] = getSetAnimationPath(setId, data.name);

          if (!set.actionMap) set.actionMap = {};
          set.actionMap[data.name] = data.name;

          if (data.trigger === 'idle') {
            if (!set.idlePlaylist) set.idlePlaylist = [];
            const weight = Math.max(1, Math.min(10, parseInt(data.idleWeight, 10) || 1));
            for (let i = 0; i < weight; i++) set.idlePlaylist.push(data.name);
          }

          saveActionSets();

          // Broadcast if this is the active set
          if (setId === actionSets.getActiveSetId()) {
            broadcastSetConfig(setId);
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ actions: buildActionsList(setId) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    // DELETE /action-sets/:id/actions/:name — delete action from set
    if (req.method === 'DELETE' && req.url.match(/^\/action-sets\/[^/]+\/actions\/[^/]+$/)) {
      const parts = req.url.split('/');
      const setId = decodeURIComponent(parts[2]);
      const actionName = decodeURIComponent(parts[4]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }

      // Remove from animations
      if (set.animations) delete set.animations[actionName];

      // Remove from idlePlaylist
      if (set.idlePlaylist) {
        set.idlePlaylist = set.idlePlaylist.filter(n => n !== actionName);
      }

      // Remove from actionMap where value matches
      if (set.actionMap) {
        for (const [trigger, gifName] of Object.entries(set.actionMap)) {
          if (gifName === actionName) delete set.actionMap[trigger];
        }
      }

      saveActionSets();

      // Broadcast if this is the active set
      if (setId === actionSets.getActiveSetId()) {
        broadcastSetConfig(setId);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actions: buildActionsList(setId) }));
      return true;
    }

    // PATCH /action-sets/:id/idle-playlist — update idle config for an action
    // Body: { name: string, enabled: boolean, weight?: number (1-10) }
    if (req.method === 'PATCH' && req.url.match(/^\/action-sets\/[^/]+\/idle-playlist$/)) {
      const setId = decodeURIComponent(req.url.split('/')[2]);
      const set = getSetById(setId);
      if (!set) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'set not found' }));
        return true;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.name || typeof data.enabled !== 'boolean') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name and enabled (boolean) are required' }));
            return;
          }
          // Verify action exists in this set
          if (!set.animations || !(data.name in set.animations)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `action "${data.name}" not found in set` }));
            return;
          }

          const weight = Math.max(1, Math.min(10, parseInt(data.weight, 10) || 1));
          if (!set.idlePlaylist) set.idlePlaylist = [];

          // Remove all existing entries of this action
          set.idlePlaylist = set.idlePlaylist.filter(n => n !== data.name);

          // If enabling, add back with the specified weight
          if (data.enabled) {
            for (let i = 0; i < weight; i++) set.idlePlaylist.push(data.name);
          }

          saveActionSets();
          if (setId === actionSets.getActiveSetId()) broadcastSetConfig(setId);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ actions: buildActionsList(setId) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return true;
    }

    return false;
  };
};
