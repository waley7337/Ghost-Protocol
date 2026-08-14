/**
 * Phase 9 — cross-account local progress isolation (separate from WAL-254 H1).
 * Switching Google A → B must never retain A's identity or progress.
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

function emptyProgress() {
  return {
    xp: 0,
    solved: [],
    streak: 0,
    lastDay: null,
    bestTimes: {},
    notes: {},
    quizScores: {},
    achievements: [],
    unlocks: [],
    preferences: {},
    settings: {}
  };
}

function createProgressStore(initial = {}) {
  let storage = {
    xp: Number(initial.xp) || 0,
    solved: Array.isArray(initial.solved) ? [...initial.solved] : [],
    streak: Number(initial.streak) || 0,
    lastDay: initial.lastDay || null,
    bestTimes: { ...(initial.bestTimes || {}) },
    notes: { ...(initial.notes || {}) },
    quizScores: { ...(initial.quizScores || {}) },
    achievements: [...(initial.achievements || [])],
    unlocks: [...(initial.unlocks || [])],
    preferences: { ...(initial.preferences || {}) },
    settings: { ...(initial.settings || {}) }
  };

  return {
    emptySnapshot: () => emptyProgress(),
    snapshot: () => ({ ...storage, solved: [...storage.solved], notes: { ...storage.notes } }),
    reset: () => {
      storage = emptyProgress();
    },
    hydrate: (incoming = {}) => {
      storage = {
        xp: Number(incoming.xp) || 0,
        solved: Array.isArray(incoming.solved) ? [...incoming.solved] : [],
        streak: Number(incoming.streak) || 0,
        lastDay: incoming.lastDay || null,
        bestTimes: incoming.bestTimes && typeof incoming.bestTimes === 'object' ? { ...incoming.bestTimes } : {},
        notes: incoming.notes && typeof incoming.notes === 'object' ? { ...incoming.notes } : {},
        quizScores:
          incoming.quizScores && typeof incoming.quizScores === 'object' ? { ...incoming.quizScores } : {},
        achievements: Array.isArray(incoming.achievements) ? [...incoming.achievements] : [],
        unlocks: Array.isArray(incoming.unlocks) ? [...incoming.unlocks] : [],
        preferences:
          incoming.preferences && typeof incoming.preferences === 'object' ? { ...incoming.preferences } : {},
        settings: incoming.settings && typeof incoming.settings === 'object' ? { ...incoming.settings } : {}
      };
    }
  };
}

function isValidProgressSnapshot(progress) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return false;
  if (Object.keys(progress).length === 0) return false;
  if (typeof progress.xp !== 'number' || !Number.isFinite(progress.xp)) return false;
  if (!Array.isArray(progress.solved)) return false;
  if (typeof progress.streak !== 'number' || !Number.isFinite(progress.streak)) return false;
  if (!(progress.lastDay === null || typeof progress.lastDay === 'string')) return false;
  if (!progress.bestTimes || typeof progress.bestTimes !== 'object') return false;
  if (!progress.notes || typeof progress.notes !== 'object') return false;
  if (!progress.quizScores || typeof progress.quizScores !== 'object') return false;
  if (!Array.isArray(progress.achievements)) return false;
  if (!Array.isArray(progress.unlocks)) return false;
  if (!progress.preferences || typeof progress.preferences !== 'object') return false;
  if (!progress.settings || typeof progress.settings !== 'object') return false;
  return true;
}

/**
 * Mirrors src/auth.js loadProgressWithBarrier after cross-account isolation fix.
 */
async function loadProgressWithBarrier(api, store) {
  store.reset();
  try {
    const result = await api.getProgress();
    if (result?.progress) {
      store.hydrate(result.progress);
      return { bootstrapped: false, progress: store.snapshot() };
    }
  } catch (error) {
    if (error?.code === 'progress_not_found' || error?.status === 404) {
      const empty = store.emptySnapshot();
      assert.equal(isValidProgressSnapshot(empty), true);
      await api.putProgress(empty);
      store.hydrate(empty);
      return { bootstrapped: true, progress: store.snapshot() };
    }
    throw error;
  }
  return { bootstrapped: false, progress: store.snapshot() };
}

test('index.html exposes GhostProgress.reset and emptySnapshot', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /emptySnapshot\s*:/);
  assert.match(html, /reset\s*:\s*\(\)\s*=>/);
  assert.match(html, /localStorage\.removeItem\(['"]ghost_protocol['"]\)/);
});

test('auth.js resets local progress before hydrate and bootstraps empty on 404', () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.match(auth, /resetLocalProgressForNewSession/);
  assert.match(auth, /canonicalEmptyProgress/);
  assert.match(auth, /GhostProgress\?\.reset/);
  assert.match(auth, /putProgress\(empty\)/);
  assert.doesNotMatch(auth, /putProgress\(local\)/);
  assert.match(auth, /resetLocalProgressForNewSession\(\);\s*\n\s*showGate\(true\)/);
});

test('logout clears web authentication state completely', async () => {
  let refreshStored = 'refresh-a';
  const api = createApiClient({
    baseUrl: 'https://api.example',
    storage: memoryStorage(refreshStored),
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/auth/logout') && init.method === 'POST') {
        return jsonResponse(204, null);
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    }
  });
  await api.setSession({
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    user: { id: 'user-a', email: 'a@example.com' }
  });
  assert.equal(api.isAuthenticated(), true);
  await api.logout();
  assert.equal(api.isAuthenticated(), false);
  assert.equal(api.getAccessToken(), null);
  assert.equal(api.getRefreshToken(), null);
  assert.equal(api.getUser(), null);
});

test('Google exchange replaces previous session completely', async () => {
  const calls = [];
  const api = createApiClient({
    baseUrl: 'https://api.example',
    storage: memoryStorage('refresh-a'),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith('/auth/google/exchange')) {
        return jsonResponse(200, {
          accessToken: 'access-b',
          refreshToken: 'refresh-b',
          user: { id: 'user-b', email: 'b@example.com' }
        });
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    }
  });
  await api.setSession({
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    user: { id: 'user-a', email: 'a@example.com' }
  });
  await api.exchangeGoogle('exchange-b');
  assert.equal(api.getAccessToken(), 'access-b');
  assert.equal(api.getRefreshToken(), 'refresh-b');
  assert.equal(api.getUser()?.id, 'user-b');
  assert.notEqual(api.getUser()?.id, 'user-a');
});

test('switching A→B never retains A progress on 404 bootstrap', async () => {
  const store = createProgressStore({
    xp: 1400,
    solved: ['LAB-01', 'LAB-02', 'LAB-03', 'LAB-04', 'LAB-05'],
    streak: 3,
    lastDay: 'Mon Aug 10 2026',
    notes: { 'LAB-01': 'secret-notes-from-a' }
  });
  assert.equal(store.snapshot().xp, 1400);

  const puts = [];
  const api = createApiClient({
    baseUrl: 'https://api.example',
    storage: memoryStorage(),
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/auth/google/exchange')) {
        return jsonResponse(200, {
          accessToken: 'access-b',
          refreshToken: 'refresh-b',
          user: { id: 'user-b', email: 'new-google@example.com' }
        });
      }
      if (String(url).endsWith('/me/progress') && init.method === 'GET') {
        return jsonResponse(404, { error: 'progress_not_found', message: 'No progress saved yet' });
      }
      if (String(url).endsWith('/me/progress') && init.method === 'PUT') {
        puts.push(JSON.parse(init.body));
        return jsonResponse(200, { progress: JSON.parse(init.body) });
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    }
  });

  await api.setSession({
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    user: { id: 'user-a', email: 'a@example.com' }
  });
  await api.exchangeGoogle('exchange-for-b');
  assert.equal(api.getUser()?.id, 'user-b');

  const result = await loadProgressWithBarrier(api, store);
  assert.equal(result.bootstrapped, true);
  assert.equal(result.progress.xp, 0);
  assert.deepEqual(result.progress.solved, []);
  assert.equal(result.progress.notes['LAB-01'], undefined);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].xp, 0);
  assert.deepEqual(puts[0].solved, []);
  assert.notEqual(puts[0].xp, 1400);
});

test('stale local cannot masquerade as B when server returns B progress', async () => {
  const store = createProgressStore({
    xp: 1400,
    solved: ['LAB-01', 'LAB-02', 'LAB-03', 'LAB-04', 'LAB-05']
  });
  const api = createApiClient({
    baseUrl: 'https://api.example',
    storage: memoryStorage(),
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/me/progress') && init.method === 'GET') {
        return jsonResponse(200, {
          progress: {
            ...emptyProgress(),
            xp: 0,
            solved: []
          }
        });
      }
      if (String(url).endsWith('/me/progress') && init.method === 'PUT') {
        throw new Error('unexpected PUT — hydrate must not echo');
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    }
  });
  await api.setSession({
    accessToken: 'access-b',
    refreshToken: 'refresh-b',
    user: { id: 'user-b', email: 'b@example.com' }
  });
  const result = await loadProgressWithBarrier(api, store);
  assert.equal(result.bootstrapped, false);
  assert.equal(result.progress.xp, 0);
  assert.deepEqual(result.progress.solved, []);
});

test('new Google subject session is distinct from prior user id', async () => {
  const api = createApiClient({
    baseUrl: 'https://api.example',
    storage: memoryStorage(),
    fetchImpl: async (url) => {
      if (String(url).endsWith('/auth/google/exchange')) {
        return jsonResponse(200, {
          accessToken: 't',
          refreshToken: 'r',
          user: { id: 'brand-new-google-user', email: 'fresh@example.com' }
        });
      }
      throw new Error('unexpected');
    }
  });
  await api.setSession({
    accessToken: 'old',
    refreshToken: 'old-r',
    user: { id: 'prior-user', email: 'prior@example.com' }
  });
  await api.exchangeGoogle('code');
  assert.equal(api.getUser()?.id, 'brand-new-google-user');
  assert.notEqual(api.getUser()?.id, 'prior-user');
});
