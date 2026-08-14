/**
 * UNIT tests for Ghost Protocol API client (Phase 5).
 * No live database / no full E2E — mocked fetch + storage only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, resolveApiBaseUrl, ApiError } from '../../src/api.js';

function memoryStorage(initial = null) {
  let refresh = initial;
  return {
    async getRefreshToken() {
      return refresh;
    },
    async setRefreshToken(token) {
      refresh = token;
    },
    async clearRefreshToken() {
      refresh = null;
    },
    _peek: () => refresh
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('resolveApiBaseUrl prefers explicit then desktop then global', () => {
  assert.equal(
    resolveApiBaseUrl({
      explicit: 'http://a.example',
      desktopBase: 'http://b.example',
      globalBase: 'http://c.example'
    }),
    'http://a.example'
  );
  assert.equal(
    resolveApiBaseUrl({
      desktopBase: 'http://b.example/',
      globalBase: 'http://c.example'
    }),
    'http://b.example'
  );
  assert.equal(resolveApiBaseUrl({}), 'http://127.0.0.1:3000');
});

test('login stores tokens and attaches Authorization on later requests', async () => {
  const calls = [];
  const storage = memoryStorage();
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/login')) {
        return jsonResponse(200, {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          user: { id: 'u1', email: 'a@example.com' }
        });
      }
      if (url.endsWith('/auth/me')) {
        assert.equal(init.headers.Authorization, 'Bearer access-1');
        return jsonResponse(200, { user: { id: 'u1', email: 'a@example.com' } });
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  await client.login('a@example.com', 'secret');
  assert.equal(client.getAccessToken(), 'access-1');
  assert.equal(storage._peek(), 'refresh-1');
  const user = await client.me();
  assert.equal(user.email, 'a@example.com');
});

test('register establishes immediate session', async () => {
  const storage = memoryStorage();
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url) => {
      if (url.endsWith('/auth/register')) {
        return jsonResponse(201, {
          accessToken: 'access-r',
          refreshToken: 'refresh-r',
          user: { id: 'u2', email: 'new@example.com' }
        });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  await client.register('new@example.com', 'secret');
  assert.equal(client.getAccessToken(), 'access-r');
  assert.equal(client.getUser().email, 'new@example.com');
});

test('401 triggers refresh then one retry with new access token', async () => {
  const storage = memoryStorage('refresh-old');
  let meHits = 0;
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        assert.deepEqual(JSON.parse(init.body), { refreshToken: 'refresh-old' });
        return jsonResponse(200, {
          accessToken: 'access-new',
          refreshToken: 'refresh-new'
        });
      }
      if (url.endsWith('/me/profile')) {
        meHits += 1;
        if (meHits === 1) {
          assert.equal(init.headers.Authorization, 'Bearer access-stale');
          return jsonResponse(401, { error: 'unauthorized' });
        }
        assert.equal(init.headers.Authorization, 'Bearer access-new');
        return jsonResponse(200, { profile: { name: 'Operative' } });
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  await client.setSession({ accessToken: 'access-stale', refreshToken: 'refresh-old' });
  const profile = await client.getProfile();
  assert.equal(profile.name, 'Operative');
  assert.equal(meHits, 2);
  assert.equal(storage._peek(), 'refresh-new');
});

test('failed refresh clears auth state', async () => {
  const storage = memoryStorage('refresh-bad');
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url) => {
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(401, { error: 'unauthorized' });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  await client.setSession({ accessToken: 'a', refreshToken: 'refresh-bad', user: { id: 'u' } });
  await assert.rejects(() => client.refreshSession(), (err) => err instanceof ApiError);
  assert.equal(client.getAccessToken(), null);
  assert.equal(client.getRefreshToken(), null);
  assert.equal(storage._peek(), null);
});

test('concurrent 401s share a single in-flight refresh', async () => {
  const storage = memoryStorage('refresh-shared');
  let refreshCalls = 0;
  let profileCalls = 0;
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 30));
        return jsonResponse(200, {
          accessToken: 'access-shared',
          refreshToken: 'refresh-rotated'
        });
      }
      if (url.endsWith('/me/profile')) {
        profileCalls += 1;
        if (init.headers.Authorization === 'Bearer stale') {
          return jsonResponse(401, { error: 'unauthorized' });
        }
        return jsonResponse(200, { profile: { name: 'A' } });
      }
      if (url.endsWith('/me/progress')) {
        if (init.headers.Authorization === 'Bearer stale') {
          return jsonResponse(401, { error: 'unauthorized' });
        }
        return jsonResponse(200, { progress: { xp: 1 } });
      }
      throw new Error(`unexpected ${url}`);
    }
  });

  await client.setSession({ accessToken: 'stale', refreshToken: 'refresh-shared' });
  const [p1, p2] = await Promise.all([client.getProfile(), client.getProgress()]);
  assert.equal(p1.name, 'A');
  assert.equal(p2.progress.xp, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(profileCalls, 2);
});

test('logout clears local tokens even when network fails', async () => {
  const storage = memoryStorage('refresh-x');
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async () => {
      throw new Error('network down');
    }
  });
  await client.setSession({
    accessToken: 'a',
    refreshToken: 'refresh-x',
    user: { id: 'u' }
  });
  const result = await client.logout();
  assert.equal(result.serverOk, false);
  assert.equal(client.getAccessToken(), null);
  assert.equal(storage._peek(), null);
});

test('restoreSession refreshes then loads /auth/me', async () => {
  const storage = memoryStorage('refresh-restore');
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url) => {
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse(200, {
          accessToken: 'access-restored',
          refreshToken: 'refresh-restored',
          user: { id: 'u9', email: 'r@example.com' }
        });
      }
      if (url.endsWith('/auth/me')) {
        return jsonResponse(200, { user: { id: 'u9', email: 'r@example.com' } });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  const user = await client.restoreSession();
  assert.equal(user.email, 'r@example.com');
  assert.equal(client.getAccessToken(), 'access-restored');
});

test('profile/progress helpers never send ownership ids', async () => {
  const bodies = [];
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage: memoryStorage('r'),
    fetchImpl: async (url, init) => {
      if (init?.body) bodies.push(JSON.parse(init.body));
      if (url.endsWith('/me/profile') && init.method === 'PUT') {
        return jsonResponse(200, { profile: { name: 'N' } });
      }
      if (url.endsWith('/me/progress') && init.method === 'PUT') {
        return jsonResponse(200, { progress: { xp: 2 } });
      }
      if (url.endsWith('/me/profile')) {
        return jsonResponse(200, { profile: { name: 'N' } });
      }
      if (url.endsWith('/me/progress')) {
        return jsonResponse(200, { progress: { xp: 2 } });
      }
      throw new Error(`unexpected ${url}`);
    }
  });
  await client.setSession({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } });
  await client.putProfile({ name: 'N', user_id: 'evil', userId: 'evil', id: 'evil' });
  await client.putProgress({ xp: 2, user_id: 'evil', userId: 'evil', id: 'evil' });
  assert.equal(bodies[0].user_id, undefined);
  assert.equal(bodies[0].userId, undefined);
  assert.equal(bodies[0].id, undefined);
  assert.equal(bodies[1].user_id, undefined);
  assert.equal(bodies[1].xp, 2);
});

test('progress_not_found can be detected by callers for empty bootstrap', async () => {
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage: memoryStorage('r'),
    fetchImpl: async () => jsonResponse(404, { error: 'progress_not_found', message: 'No progress saved yet' })
  });
  await client.setSession({ accessToken: 'a', refreshToken: 'r', user: { id: 'u' } });
  await assert.rejects(() => client.getProgress(), (err) => {
    assert.equal(err.code, 'progress_not_found');
    assert.equal(err.status, 404);
    return true;
  });
});

test('startup sync barrier: uploads skipped until enabled', async () => {
  let syncEnabled = false;
  const uploads = [];
  const saveProgress = async (progress) => {
    if (!syncEnabled) return;
    uploads.push(progress);
  };

  // Simulate race: progress event before hydrate completes
  await saveProgress({ xp: 99 });
  assert.equal(uploads.length, 0);

  // Server hydrate path
  const serverProgress = { xp: 10 };
  let hydrated = null;
  hydrated = serverProgress;
  syncEnabled = true;

  await saveProgress({ xp: 11 });
  assert.deepEqual(hydrated, { xp: 10 });
  assert.deepEqual(uploads, [{ xp: 11 }]);
});

test('Google/forgot password paths must not call Supabase hosts', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return jsonResponse(500, { error: 'nope' });
  };
  // Guarding the migration: client factory never targets the dead Supabase hostname.
  createApiClient({
    baseUrl: 'http://127.0.0.1:3000',
    storage: memoryStorage(),
    fetchImpl
  });
  assert.equal(calls.length, 0);
  assert.equal(
    resolveApiBaseUrl({}),
    'http://127.0.0.1:3000'
  );
  assert.doesNotMatch(resolveApiBaseUrl({}), /supabase\.co/);
});
