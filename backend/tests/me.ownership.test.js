'use strict';

/**
 * Phase 4: profile + progress API and cross-user ownership isolation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadConfig } = require('../src/config');
const { createRequestListener } = require('../src/routes');
const { validateProgressPayload, LIMITS } = require('../src/services/progressValidation');
const { validateProfileUpdate } = require('../src/services/profiles');
const { AppError } = require('../src/errors');

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://example',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    JWT_ISSUER: 'ghost-protocol-api-test',
    JWT_AUDIENCE: 'ghost-protocol-clients-test',
    AUTH_RATE_LIMIT_MAX: '1000',
    PROGRESS_BODY_LIMIT_BYTES: '65536'
  });
}

function createMemoryPool() {
  const users = new Map();
  const sessions = new Map();
  const profiles = new Map();
  const progressRows = new Map();
  let userSeq = 0;
  let sessionSeq = 0;

  async function exec(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

    if (sql.startsWith('INSERT INTO users')) {
      const [email, passwordHash] = params;
      for (const user of users.values()) {
        if (user.email === email) {
          const error = new Error('duplicate');
          error.code = '23505';
          throw error;
        }
      }
      userSeq += 1;
      const id = `00000000-0000-4000-8000-${String(userSeq).padStart(12, '0')}`;
      const row = {
        id,
        email,
        password_hash: passwordHash,
        email_verified: false,
        created_at: new Date().toISOString()
      };
      users.set(id, row);
      return { rows: [row] };
    }

    if (sql.startsWith('SELECT id, email, password_hash, email_verified, created_at FROM users WHERE email')) {
      const row = [...users.values()].find((user) => user.email === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT id, email, email_verified, created_at FROM users WHERE id')) {
      const row = users.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('INSERT INTO sessions')) {
      let userId;
      let familyId;
      let parentSessionId = null;
      let refreshTokenHash;
      let expiresAt;
      let userAgent = null;
      let ipAddress = null;
      if (sql.includes('family_id, parent_session_id, refresh_token_hash')) {
        [userId, familyId, parentSessionId, refreshTokenHash, expiresAt, userAgent, ipAddress] =
          params;
      } else {
        [userId, familyId, refreshTokenHash, expiresAt, userAgent, ipAddress] = params;
      }
      for (const existing of sessions.values()) {
        if (existing.family_id === familyId && existing.revoked_at == null) {
          const error = new Error('unique active family');
          error.code = '23505';
          throw error;
        }
      }
      sessionSeq += 1;
      const id = `10000000-0000-4000-8000-${String(sessionSeq).padStart(12, '0')}`;
      const row = {
        id,
        user_id: userId,
        family_id: familyId,
        parent_session_id: parentSessionId,
        replaced_by_session_id: null,
        refresh_token_hash: refreshTokenHash,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        revoked_at: null,
        last_used_at: new Date().toISOString(),
        user_agent: userAgent,
        ip_address: ipAddress
      };
      sessions.set(id, row);
      return { rows: [row] };
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by_session_id FROM sessions WHERE refresh_token_hash'
      )
    ) {
      const row = [...sessions.values()].find((session) => session.refresh_token_hash === params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.startsWith('SELECT id FROM sessions WHERE refresh_token_hash')) {
      const row = [...sessions.values()].find((session) => session.refresh_token_hash === params[0]);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (sql.includes('SET replaced_by_session_id = $2') && !sql.includes('revoked_at')) {
      const row = sessions.get(params[0]);
      if (row) row.replaced_by_session_id = params[1];
      return { rows: [] };
    }

    if (sql.includes('WHERE family_id = $1') && sql.includes('revoked_at IS NULL')) {
      for (const row of sessions.values()) {
        if (row.family_id === params[0] && row.revoked_at == null) {
          row.revoked_at = new Date().toISOString();
        }
      }
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE sessions SET revoked_at') && sql.includes('WHERE id')) {
      const row = sessions.get(params[0]);
      if (row && !row.revoked_at) row.revoked_at = new Date().toISOString();
      return { rows: [] };
    }

    if (sql.startsWith('INSERT INTO profiles')) {
      const [userId, name, avatarUrl] = params;
      const now = new Date().toISOString();
      if (sql.includes('ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name')) {
        const existing = profiles.get(userId);
        const row = {
          user_id: userId,
          name,
          avatar_url: avatarUrl,
          created_at: existing?.created_at || now,
          updated_at: now
        };
        profiles.set(userId, row);
        return { rows: [row] };
      }
      if (sql.includes('ON CONFLICT (user_id) DO UPDATE SET name = profiles.name')) {
        if (!profiles.has(userId)) {
          const row = {
            user_id: userId,
            name,
            avatar_url: avatarUrl,
            created_at: now,
            updated_at: now
          };
          profiles.set(userId, row);
          return { rows: [row] };
        }
        return { rows: [profiles.get(userId)] };
      }
    }

    if (sql.startsWith('SELECT progress, created_at, updated_at FROM user_progress WHERE user_id')) {
      const row = progressRows.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('INSERT INTO user_progress')) {
      const [userId, progressJson] = params;
      const now = new Date().toISOString();
      const progress = typeof progressJson === 'string' ? JSON.parse(progressJson) : progressJson;
      const existing = progressRows.get(userId);
      const row = {
        user_id: userId,
        progress,
        created_at: existing?.created_at || now,
        updated_at: now
      };
      progressRows.set(userId, row);
      return { rows: [row] };
    }

    throw new Error(`Unhandled SQL in memory pool: ${sql}`);
  }

  return {
    query: exec,
    async connect() {
      return { query: exec, release() {} };
    },
    _users: users,
    _profiles: profiles,
    _progress: progressRows
  };
}

async function withServer(run) {
  const config = testConfig();
  const pool = createMemoryPool();
  const server = http.createServer(
    createRequestListener(config, {
      checkDb: async () => true,
      getPool: () => pool
    })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await run({ base, pool, config });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function register(base, email) {
  const response = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse' })
  });
  assert.equal(response.status, 201);
  return response.json();
}

test('validateProfileUpdate allowlists fields and rejects bad types', () => {
  assert.throws(
    () => validateProfileUpdate({ name: 'A', role: 'admin' }),
    (error) => error instanceof AppError && error.code === 'unsupported_field'
  );
  assert.throws(
    () => validateProfileUpdate({ name: 123 }),
    (error) => error instanceof AppError && error.code === 'invalid_name'
  );
  const ok = validateProfileUpdate({
    name: ' Operative ',
    avatarUrl: 'https://cdn.example.com/a.png'
  });
  assert.equal(ok.name, 'Operative');
  assert.equal(ok.avatarUrl, 'https://cdn.example.com/a.png');
});

test('validateProgressPayload enforces structure and XP bounds', () => {
  const ok = validateProgressPayload({
    xp: 150,
    solved: ['lab-1'],
    streak: 2,
    lastDay: 'Mon',
    bestTimes: {},
    notes: {},
    quizScores: {},
    achievements: [],
    unlocks: [],
    preferences: {},
    settings: {}
  });
  assert.equal(ok.xp, 150);

  assert.throws(
    () => validateProgressPayload({ xp: -1 }),
    (error) => error instanceof AppError && error.code === 'invalid_xp'
  );
  assert.throws(
    () => validateProgressPayload({ xp: LIMITS.maxXp + 1 }),
    (error) => error instanceof AppError && error.code === 'invalid_xp'
  );
  assert.throws(
    () => validateProgressPayload({ evil: true }),
    (error) => error instanceof AppError && error.code === 'unsupported_field'
  );
  assert.throws(
    () => validateProgressPayload({ solved: [1, 2] }),
    (error) => error instanceof AppError && error.code === 'invalid_solved'
  );
});

test('profile GET/PUT require auth and return own profile', async () => {
  await withServer(async ({ base }) => {
    const unauth = await fetch(`${base}/me/profile`);
    assert.equal(unauth.status, 401);

    const user = await register(base, 'profile@example.com');
    const get = await fetch(`${base}/me/profile`, {
      headers: { authorization: `Bearer ${user.accessToken}` }
    });
    assert.equal(get.status, 200);
    const got = await get.json();
    assert.equal(got.profile.name, 'Operative');
    assert.equal(got.profile.avatarUrl, null);
    assert.equal(JSON.stringify(got).includes('password'), false);

    const put = await fetch(`${base}/me/profile`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'Ghost', avatarUrl: 'https://cdn.example.com/g.png' })
    });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).profile.name, 'Ghost');

    const badField = await fetch(`${base}/me/profile`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'X', role: 'admin' })
    });
    assert.equal(badField.status, 400);
    assert.equal((await badField.json()).error, 'unsupported_field');

    const ignoreOwnership = await fetch(`${base}/me/profile`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'StillMe', user_id: 'attacker', userId: 'attacker' })
    });
    assert.equal(ignoreOwnership.status, 200);
    assert.equal((await ignoreOwnership.json()).profile.name, 'StillMe');
  });
});

test('progress GET 404 then PUT/GET round-trip; rejects invalid payloads', async () => {
  await withServer(async ({ base }) => {
    const unauth = await fetch(`${base}/me/progress`);
    assert.equal(unauth.status, 401);

    const user = await register(base, 'progress@example.com');
    const missing = await fetch(`${base}/me/progress`, {
      headers: { authorization: `Bearer ${user.accessToken}` }
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, 'progress_not_found');

    const payload = {
      xp: 300,
      solved: ['lab-01'],
      streak: 3,
      lastDay: 'Tue Aug 12 2026',
      bestTimes: { 'lab-01': 42 },
      notes: { 'lab-01': 'desync' },
      quizScores: {},
      achievements: ['first'],
      unlocks: [],
      preferences: {},
      settings: { theme: 'green' }
    };

    const put = await fetch(`${base}/me/progress`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).progress.xp, 300);

    const get = await fetch(`${base}/me/progress`, {
      headers: { authorization: `Bearer ${user.accessToken}` }
    });
    assert.equal(get.status, 200);
    assert.deepEqual((await get.json()).progress.solved, ['lab-01']);

    const badXp = await fetch(`${base}/me/progress`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ xp: 'nope' })
    });
    assert.equal(badXp.status, 400);
  });
});

test('cross-user isolation: A cannot read or modify B profile/progress', async () => {
  await withServer(async ({ base, pool }) => {
    const a = await register(base, 'alice@example.com');
    const b = await register(base, 'bob@example.com');

    await fetch(`${base}/me/profile`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${b.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'Bob' })
    });
    await fetch(`${base}/me/progress`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${b.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ xp: 999, solved: ['secret-lab'] })
    });

    const bobId = [...pool._users.values()].find((u) => u.email === 'bob@example.com').id;

    const aProfile = await fetch(`${base}/me/profile?user_id=${bobId}`, {
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        'x-user-id': bobId
      }
    });
    assert.equal(aProfile.status, 200);
    assert.equal((await aProfile.json()).profile.name, 'Operative');

    const aPutProfile = await fetch(`${base}/me/profile`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: 'Alice', user_id: bobId, userId: bobId, id: bobId })
    });
    assert.equal(aPutProfile.status, 200);
    assert.equal((await aPutProfile.json()).profile.name, 'Alice');
    assert.equal(pool._profiles.get(bobId).name, 'Bob');

    const aProgress = await fetch(`${base}/me/progress?user_id=${bobId}`, {
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        'x-user-id': bobId
      }
    });
    assert.equal(aProgress.status, 404);

    const aPutProgress = await fetch(`${base}/me/progress`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${a.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        xp: 1,
        user_id: bobId,
        userId: bobId,
        solved: ['a-only']
      })
    });
    assert.equal(aPutProgress.status, 200);
    assert.equal(pool._progress.get(bobId).progress.xp, 999);
    assert.deepEqual(pool._progress.get(bobId).progress.solved, ['secret-lab']);
  });
});

test('oversized progress body is rejected', async () => {
  await withServer(async ({ base }) => {
    const user = await register(base, 'big@example.com');
    const huge = 'x'.repeat(70_000);
    const response = await fetch(`${base}/me/progress`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${user.accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ notes: { a: huge } })
    });
    assert.equal(response.status, 413);
  });
});
