/**
 * E4 / WAL-202 regression: mission notes must serialize, sync, and survive hydrate.
 * Behavioral logic mirrors index.html GhostProgress + auth dirty/pending flush/barrier.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiClient } from '../../src/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function memoryStorage(seedRefresh = null) {
  let refresh = seedRefresh;
  return {
    async getRefreshToken() {
      return refresh;
    },
    async setRefreshToken(token) {
      refresh = token;
    },
    async clearRefreshToken() {
      refresh = null;
    }
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/** Minimal GhostProgress stand-in matching index.html snapshot/hydrate. */
function createProgressStore(initial = {}) {
  const state = {
    xp: Number(initial.xp) || 0,
    solved: new Set(Array.isArray(initial.solved) ? initial.solved : []),
    streak: Number(initial.streak) || 0,
    lastDay: initial.lastDay || null,
    bestTimes: initial.bestTimes && typeof initial.bestTimes === 'object' ? { ...initial.bestTimes } : {},
    notes: initial.notes && typeof initial.notes === 'object' ? { ...initial.notes } : {},
    quizScores: initial.quizScores && typeof initial.quizScores === 'object' ? { ...initial.quizScores } : {},
    achievements: Array.isArray(initial.achievements) ? [...initial.achievements] : [],
    unlocks: Array.isArray(initial.unlocks) ? [...initial.unlocks] : [],
    preferences: initial.preferences && typeof initial.preferences === 'object' ? { ...initial.preferences } : {},
    settings: initial.settings && typeof initial.settings === 'object' ? { ...initial.settings } : {}
  };

  return {
    get notes() {
      return state.notes;
    },
    setNote(labId, text) {
      state.notes[labId] = text;
    },
    snapshot: () => ({
      xp: state.xp,
      solved: [...state.solved],
      streak: state.streak,
      lastDay: state.lastDay,
      bestTimes: state.bestTimes,
      notes: state.notes,
      quizScores: state.quizScores,
      achievements: state.achievements,
      unlocks: state.unlocks,
      preferences: state.preferences,
      settings: state.settings
    }),
    hydrate: (incoming = {}) => {
      state.xp = Number(incoming.xp) || 0;
      state.solved = new Set(Array.isArray(incoming.solved) ? incoming.solved : []);
      state.streak = Number(incoming.streak) || 0;
      state.lastDay = incoming.lastDay || null;
      state.bestTimes =
        incoming.bestTimes && typeof incoming.bestTimes === 'object' ? incoming.bestTimes : {};
      state.notes = incoming.notes && typeof incoming.notes === 'object' ? incoming.notes : {};
      state.quizScores =
        incoming.quizScores && typeof incoming.quizScores === 'object' ? incoming.quizScores : {};
      state.achievements = Array.isArray(incoming.achievements) ? incoming.achievements : [];
      state.unlocks = Array.isArray(incoming.unlocks) ? incoming.unlocks : [];
      state.preferences =
        incoming.preferences && typeof incoming.preferences === 'object' ? incoming.preferences : {};
      state.settings = incoming.settings && typeof incoming.settings === 'object' ? incoming.settings : {};
    }
  };
}

/** Mirrors src/auth.js isValidProgressSnapshot. */
function isPlainProgressObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidProgressSnapshot(progress) {
  if (!isPlainProgressObject(progress)) return false;
  if (Object.keys(progress).length === 0) return false;
  if (typeof progress.xp !== 'number' || !Number.isFinite(progress.xp)) return false;
  if (!Array.isArray(progress.solved)) return false;
  if (typeof progress.streak !== 'number' || !Number.isFinite(progress.streak)) return false;
  if (!(progress.lastDay === null || typeof progress.lastDay === 'string')) return false;
  if (!isPlainProgressObject(progress.bestTimes)) return false;
  if (!isPlainProgressObject(progress.notes)) return false;
  if (!isPlainProgressObject(progress.quizScores)) return false;
  if (!Array.isArray(progress.achievements)) return false;
  if (!Array.isArray(progress.unlocks)) return false;
  if (!isPlainProgressObject(progress.preferences)) return false;
  if (!isPlainProgressObject(progress.settings)) return false;
  return true;
}

/** Mirrors auth flush/unload dirty+pending controllers. */
function createFlushController({ store, putProgress, authenticated = true }) {
  let syncEnabled = true;
  let syncTimer = null;
  let progressReady = true;
  let progressDirty = false;
  let unloadFlushStarted = false;

  const markProgressClean = () => {
    progressDirty = false;
  };
  const markProgressDirty = () => {
    progressDirty = true;
  };
  const needsProgressFlush = () => progressDirty || Boolean(syncTimer);

  const flushProgressToServer = async ({ keepalive = false } = {}) => {
    const hadPending = Boolean(syncTimer);
    clearTimeout(syncTimer);
    syncTimer = null;

    if (!syncEnabled || !authenticated) return false;
    if (!progressDirty && !hadPending) return true;

    if (!progressReady) return false;
    const progress = store.snapshot();
    if (!isValidProgressSnapshot(progress)) return false;

    await putProgress(progress, { keepalive });
    markProgressClean();
    return true;
  };

  const flushOnUnload = () => {
    if (!authenticated || !syncEnabled) return;
    if (!needsProgressFlush()) return;
    if (unloadFlushStarted) return;
    unloadFlushStarted = true;
    void flushProgressToServer({ keepalive: true }).catch(() => {
      unloadFlushStarted = false;
    });
  };

  return {
    get dirty() {
      return progressDirty;
    },
    get pending() {
      return Boolean(syncTimer);
    },
    markProgressClean,
    markProgressDirty,
    needsProgressFlush,
    setProgressReady(v) {
      progressReady = v;
    },
    scheduleDebounced() {
      markProgressDirty();
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        const progress = store.snapshot();
        if (!isValidProgressSnapshot(progress)) return;
        putProgress(progress)
          .then(() => markProgressClean())
          .catch(() => {});
      }, 700);
    },
    flushProgressToServer,
    flushOnUnload,
    onVisibilityHidden() {
      flushOnUnload();
    },
    onVisibilityVisible() {
      unloadFlushStarted = false;
    },
    async logout() {
      let flushOk = true;
      const flushAttempted = authenticated && syncEnabled && needsProgressFlush();
      if (flushAttempted) {
        try {
          flushOk = await flushProgressToServer();
        } catch {
          flushOk = false;
        }
      }
      syncEnabled = false;
      clearTimeout(syncTimer);
      syncTimer = null;
      progressReady = false;
      markProgressClean();
      return { flushAttempted, flushOk };
    }
  };
}

/** Shared hydrate payload shape used by web and Electron (same GhostProgress contract). */
function assertHydrationFormat(progress) {
  assert.equal(typeof progress, 'object');
  assert.equal(typeof progress.xp, 'number');
  assert.ok(Array.isArray(progress.solved));
  assert.equal(typeof progress.notes, 'object');
  assert.ok(progress.notes === null || !Array.isArray(progress.notes));
  assert.equal(typeof progress.bestTimes, 'object');
}

test('index.html serializes notes in GhostProgress snapshot and saveState', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /notes:ST\.notes/);
  assert.match(html, /ST\.notes=state\.notes/);
  assert.match(html, /function captureNoteFromDom\s*\(/);
  assert.match(html, /window\.captureNoteFromDom\s*=\s*captureNoteFromDom/);
  assert.match(html, /function saveNote\s*\(\)\s*\{\s*captureNoteFromDom\(\);\s*saveState\(\);\s*\}/);
  assert.match(html, /oninput="saveNote\(\)"/);
  assert.match(html, /onchange="saveNote\(\)"/);
  // Hydrated render equality must short-circuit (no false dirty write).
  assert.match(html, /if\(ST\.notes\[CUR\.id\]===next\)return;/);
});

test('auth.js flushes progress (including notes) before logout disables sync', () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.match(auth, /async function flushProgressToServer/);
  assert.match(auth, /captureNoteFromDom/);
  assert.match(auth, /GhostProgress\?\.snapshot\(\)/);
  assert.match(auth, /needsProgressFlush\(\)/);
  assert.match(auth, /isValidProgressSnapshot/);
  assert.match(auth, /pagehide/);
  assert.match(auth, /visibilitychange/);
  assert.match(auth, /keepalive:\s*true/);
  assert.match(auth, /unloadFlushStarted/);
  assert.match(auth, /WAL-251/);
  // Flush must happen before disableSync on logout when dirty/pending.
  const logoutIdx = auth.indexOf("$('auth-logout').onclick");
  const flushIdx = auth.indexOf('await flushProgressToServer()', logoutIdx);
  const disableIdx = auth.indexOf('disableSync()', flushIdx);
  assert.ok(logoutIdx >= 0 && flushIdx > logoutIdx && disableIdx > flushIdx);
  // Failed flush must surface a warning (not silent success).
  assert.match(auth, /Progress sync may be incomplete/);
  // Must not use weak empty-object stringify guard as the sole PUT gate.
  assert.doesNotMatch(auth, /JSON\.stringify\(progress\)\s*!==\s*['"]\{\}['"]/);
});

test('notes serialize into progress payload for PUT /me/progress', async () => {
  const bodies = [];
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    notes: {}
  });
  store.setNote('cl_te_basic', 'CL.TE: front CL, back TE');

  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage: memoryStorage('r'),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/me/progress') && init.method === 'PUT') {
        bodies.push(JSON.parse(init.body));
        return jsonResponse(200, { progress: JSON.parse(init.body) });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  await client.setSession({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } });
  const payload = store.snapshot();
  await client.putProgress(payload);

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].xp, 150);
  assert.deepEqual(bodies[0].solved, ['cl_te_basic']);
  assert.equal(bodies[0].notes['cl_te_basic'], 'CL.TE: front CL, back TE');
});

test('logout flush sends pending notes even when debounce would have been cancelled', async () => {
  const uploads = [];
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: {}
  });
  const ctl = createFlushController({
    store,
    putProgress: async (progress) => {
      uploads.push(progress);
    }
  });

  store.setNote('cl_te_basic', 'note before logout');
  ctl.scheduleDebounced();
  assert.equal(ctl.pending, true);

  const { flushAttempted, flushOk } = await ctl.logout();
  assert.equal(flushAttempted, true);
  assert.equal(flushOk, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].notes['cl_te_basic'], 'note before logout');
  assert.equal(uploads[0].xp, 150);
  assert.deepEqual(uploads[0].solved, ['cl_te_basic']);
});

test('logout/login hydration restores notes without changing solved/XP', () => {
  const local = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    notes: { cl_te_basic: 'local draft' }
  });

  const serverProgress = {
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: 'Fri Aug 14 2026',
    bestTimes: {},
    notes: { cl_te_basic: 'persisted mission note' },
    quizScores: {},
    achievements: [],
    unlocks: [],
    preferences: {},
    settings: {}
  };

  local.hydrate(serverProgress);
  const after = local.snapshot();
  assert.equal(after.xp, 150);
  assert.deepEqual(after.solved, ['cl_te_basic']);
  assert.equal(after.notes.cl_te_basic, 'persisted mission note');
});

test('hydrate tolerates legacy progress records with no notes field', () => {
  const store = createProgressStore({
    xp: 50,
    solved: ['cl_te_basic'],
    notes: { cl_te_basic: 'should clear to empty object when absent' }
  });
  store.hydrate({ xp: 50, solved: ['cl_te_basic'] });
  const after = store.snapshot();
  assert.equal(after.xp, 50);
  assert.deepEqual(after.solved, ['cl_te_basic']);
  assert.deepEqual(after.notes, {});
});

test('debounced sync uses GhostProgress.snapshot at flush time (not stale event.detail)', () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.match(auth, /ghost-progress-changed/);
  assert.match(auth, /const progress = window\.GhostProgress\?\.snapshot\(\)/);
  assert.doesNotMatch(
    auth,
    /setTimeout\(\s*\(\)\s*=>\s*saveProgress\(event\.detail\)/
  );
  // Must not PUT empty object fallback (would wipe server progress).
  assert.doesNotMatch(auth, /saveProgress\(progress\s*\|\|\s*\{\s*\}\)/);
});

test('notes are separated by mission ID', () => {
  const store = createProgressStore({ xp: 300, solved: ['cl_te_basic', 'te_cl_basic'] });
  store.setNote('cl_te_basic', 'note A');
  store.setNote('te_cl_basic', 'note B');
  const snap = store.snapshot();
  assert.equal(snap.notes.cl_te_basic, 'note A');
  assert.equal(snap.notes.te_cl_basic, 'note B');
  assert.equal(snap.xp, 300);
  assert.deepEqual(snap.solved, ['cl_te_basic', 'te_cl_basic']);
});

test('empty local defaults do not erase non-empty server notes on hydrate', () => {
  // Fresh browser / empty localStorage defaults.
  const local = createProgressStore({ xp: 0, solved: [], notes: {} });
  const server = {
    xp: 350,
    solved: ['cl_te_basic', 'te_cl_basic'],
    notes: { cl_te_basic: 'server note must survive empty local' },
    bestTimes: {},
    streak: 1,
    lastDay: null,
    quizScores: {},
    achievements: [],
    unlocks: [],
    preferences: {},
    settings: {}
  };
  local.hydrate(server);
  const after = local.snapshot();
  assert.equal(after.notes.cl_te_basic, 'server note must survive empty local');
  assert.equal(after.xp, 350);
  assert.deepEqual(after.solved, ['cl_te_basic', 'te_cl_basic']);
});

test('notes sync barrier: uploads stay disabled until hydrate completes', async () => {
  const uploads = [];
  let syncEnabled = false;
  const store = createProgressStore({ xp: 0, solved: [], notes: {} });

  const saveProgress = async (progress) => {
    if (!syncEnabled) return;
    uploads.push(progress);
  };

  // Stale local event before barrier completes must not upload.
  store.setNote('cl_te_basic', 'stale local');
  await saveProgress(store.snapshot());
  assert.equal(uploads.length, 0);

  const server = {
    xp: 150,
    solved: ['cl_te_basic'],
    notes: { cl_te_basic: 'from server' }
  };
  store.hydrate(server);
  syncEnabled = true;

  // After hydrate, a sync sends server-restored notes (not empty local defaults).
  await saveProgress(store.snapshot());
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].notes.cl_te_basic, 'from server');
  assert.equal(uploads[0].xp, 150);
});

test('web and Electron share the same GhostProgress hydration format', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  // Single shared GhostProgress in index.html powers both web and Electron renderers.
  assert.match(html, /window\.GhostProgress\s*=\s*Object\.freeze/);
  assert.match(html, /hydrate:\s*\(state\s*=\s*\{\}\)\s*=>/);

  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    notes: { cl_te_basic: 'shared format' }
  });
  const snap = store.snapshot();
  assertHydrationFormat(snap);

  const otherClient = createProgressStore();
  otherClient.hydrate(snap);
  assertHydrationFormat(otherClient.snapshot());
  assert.equal(otherClient.snapshot().notes.cl_te_basic, 'shared format');
});

test('putProgress can request keepalive for unload flush without starting refresh retry', async () => {
  const seen = [];
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage: memoryStorage('r'),
    fetchImpl: async (url, init) => {
      seen.push({ url, keepalive: Boolean(init.keepalive), method: init.method });
      if (url.endsWith('/me/progress') && init.method === 'PUT') {
        return jsonResponse(200, { progress: JSON.parse(init.body) });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  await client.setSession({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } });
  await client.putProgress(
    { xp: 10, solved: [], notes: { lab: 'x' }, bestTimes: {}, streak: 0, lastDay: null },
    { keepalive: true }
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].keepalive, true);
});

test('clean hydrated state does not PUT on pagehide', async () => {
  const uploads = [];
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: { cl_te_basic: 'from server' }
  });
  const ctl = createFlushController({
    store,
    putProgress: async (p) => {
      uploads.push(p);
    }
  });
  ctl.markProgressClean();
  assert.equal(ctl.needsProgressFlush(), false);
  ctl.flushOnUnload();
  await Promise.resolve();
  assert.equal(uploads.length, 0);
});

test('clean hydrated state does not PUT on visibilitychange', async () => {
  const uploads = [];
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: { cl_te_basic: 'from server' }
  });
  const ctl = createFlushController({
    store,
    putProgress: async (p) => {
      uploads.push(p);
    }
  });
  ctl.markProgressClean();
  ctl.onVisibilityHidden();
  await Promise.resolve();
  assert.equal(uploads.length, 0);
});

test('dirty notes PUT once on pagehide', async () => {
  const uploads = [];
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: {}
  });
  const ctl = createFlushController({
    store,
    putProgress: async (p) => {
      uploads.push(p);
    }
  });
  store.setNote('cl_te_basic', 'typed note');
  ctl.markProgressDirty();
  ctl.flushOnUnload();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].notes.cl_te_basic, 'typed note');
  assert.equal(ctl.dirty, false);
});

test('visibilitychange + pagehide do not duplicate the PUT', async () => {
  const uploads = [];
  let resolvePut;
  const putGate = new Promise((resolve) => {
    resolvePut = resolve;
  });
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: { cl_te_basic: 'pending' }
  });
  const ctl = createFlushController({
    store,
    putProgress: async (p) => {
      uploads.push(p);
      await putGate;
    }
  });
  ctl.markProgressDirty();
  ctl.onVisibilityHidden();
  // pagehide while first unload flush is in-flight must not start a second PUT
  ctl.flushOnUnload();
  assert.equal(uploads.length, 1);
  resolvePut();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(uploads.length, 1);
});

test('malformed or empty snapshots never PUT', async () => {
  const uploads = [];
  const malformedStore = {
    snapshot: () => ({})
  };
  const ctlEmpty = createFlushController({
    store: malformedStore,
    putProgress: async (p) => {
      uploads.push(p);
    }
  });
  ctlEmpty.markProgressDirty();
  const okEmpty = await ctlEmpty.flushProgressToServer();
  assert.equal(okEmpty, false);
  assert.equal(uploads.length, 0);

  for (const bad of [null, undefined, [], { xp: 'nope' }, { xp: 1 }]) {
    const store = { snapshot: () => bad };
    const ctl = createFlushController({
      store,
      putProgress: async (p) => {
        uploads.push(p);
      }
    });
    ctl.markProgressDirty();
    assert.equal(await ctl.flushProgressToServer(), false);
  }
  assert.equal(uploads.length, 0);
  assert.equal(isValidProgressSnapshot({}), false);
  assert.equal(isValidProgressSnapshot(null), false);
  assert.equal(isValidProgressSnapshot([]), false);
});

test('hydrated note rendering does not mark state dirty', () => {
  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: { cl_te_basic: 'server note' }
  });
  let dirty = false;
  // Mirror captureNoteFromDom equality short-circuit used by index.html.
  const captureNoteFromDom = (curId, taValue) => {
    if (store.notes[curId] === taValue) return false;
    store.setNote(curId, taValue);
    dirty = true;
    return true;
  };
  const mutated = captureNoteFromDom('cl_te_basic', 'server note');
  assert.equal(mutated, false);
  assert.equal(dirty, false);

  const ctl = createFlushController({
    store,
    putProgress: async () => {}
  });
  ctl.markProgressClean();
  // Hydrate/populate is not a ghost-progress-changed user edit.
  store.hydrate(store.snapshot());
  assert.equal(ctl.dirty, false);
  assert.equal(ctl.needsProgressFlush(), false);
});

test('logout flushes one dirty note before clearing the session', async () => {
  const uploads = [];
  const store = createProgressStore({
    xp: 200,
    solved: ['cl_te_basic'],
    streak: 2,
    lastDay: 'Fri Aug 14 2026',
    notes: {}
  });
  const ctl = createFlushController({
    store,
    putProgress: async (p) => {
      uploads.push(p);
    }
  });
  store.setNote('cl_te_basic', 'logout note');
  ctl.markProgressDirty();
  const { flushAttempted, flushOk } = await ctl.logout();
  assert.equal(flushAttempted, true);
  assert.equal(flushOk, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].notes.cl_te_basic, 'logout note');
  assert.equal(ctl.dirty, false);
  assert.equal(ctl.needsProgressFlush(), false);
});

test('failed flush produces the expected warning path', async () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.match(auth, /flushAttempted && !flushOk/);
  assert.match(
    auth,
    /Signed out\. Progress sync may be incomplete — notes might not be saved\./
  );

  const store = createProgressStore({
    xp: 150,
    solved: ['cl_te_basic'],
    streak: 1,
    lastDay: null,
    notes: { cl_te_basic: 'x' }
  });
  const ctl = createFlushController({
    store,
    putProgress: async () => {
      throw new Error('network down');
    }
  });
  ctl.markProgressDirty();
  const { flushAttempted, flushOk } = await ctl.logout();
  assert.equal(flushAttempted, true);
  assert.equal(flushOk, false);
});

test('isValidProgressSnapshot accepts a full GhostProgress snapshot', () => {
  const snap = createProgressStore({
    xp: 10,
    solved: [],
    notes: { a: 'b' }
  }).snapshot();
  assert.equal(isValidProgressSnapshot(snap), true);
});
