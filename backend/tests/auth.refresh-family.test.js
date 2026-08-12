'use strict';

/**
 * Refresh-token family rotation / reuse tests (Phase 3.1).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadConfig } = require('../src/config');
const { createRequestListener } = require('../src/routes');
const { hashRefreshToken } = require('../src/services/tokens');
const { rotateRefreshSession } = require('../src/services/sessions');

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://example',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    JWT_ISSUER: 'ghost-protocol-api-test',
    JWT_AUDIENCE: 'ghost-protocol-clients-test',
    AUTH_RATE_LIMIT_MAX: '1000'
  });
}

function createMemoryPool() {
  const users = new Map();
  const sessions = new Map();
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

    if (sql.startsWith('SELECT id, email, password_hash')) {
      const row = [...users.values()].find((user) => user.email === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT id, email, email_verified')) {
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

    if (sql.includes('FROM sessions WHERE refresh_token_hash') && sql.includes('family_id')) {
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

    if (sql.includes('replaced_by_session_id = $2')) {
      const row = sessions.get(params[0]);
      if (row) {
        row.revoked_at = row.revoked_at || new Date().toISOString();
        row.replaced_by_session_id = params[1];
        row.last_used_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    if (sql.includes('WHERE family_id = $1')) {
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

    throw new Error(`Unhandled SQL in memory pool: ${sql}`);
  }

  return {
    query: exec,
    async connect() {
      return { query: exec, release() {} };
    },
    _sessions: sessions
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

async function login(base, email) {
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse' })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function refresh(base, refreshToken) {
  return fetch(`${base}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
}

function sessionByToken(pool, config, token) {
  const hash = hashRefreshToken(token, config.refreshTokenSecret);
  return [...pool._sessions.values()].find((s) => s.refresh_token_hash === hash);
}

test('A->B and B->C rotation succeed', async () => {
  await withServer(async ({ base, config, pool }) => {
    const a = await register(base, 'rotate@example.com');
    const bRes = await refresh(base, a.refreshToken);
    assert.equal(bRes.status, 200);
    const b = await bRes.json();
    const cRes = await refresh(base, b.refreshToken);
    assert.equal(cRes.status, 200);
    const c = await cRes.json();

    const aRow = sessionByToken(pool, config, a.refreshToken);
    const bRow = sessionByToken(pool, config, b.refreshToken);
    const cRow = sessionByToken(pool, config, c.refreshToken);
    assert.ok(aRow.revoked_at);
    assert.equal(aRow.replaced_by_session_id, bRow.id);
    assert.ok(bRow.revoked_at);
    assert.equal(bRow.replaced_by_session_id, cRow.id);
    assert.equal(cRow.revoked_at, null);
    assert.equal(aRow.family_id, bRow.family_id);
    assert.equal(bRow.family_id, cRow.family_id);
  });
});

test('reuse(A) after A->B->C revokes active tip C', async () => {
  await withServer(async ({ base, config, pool }) => {
    const a = await register(base, 'reuse-a@example.com');
    const b = await (await refresh(base, a.refreshToken)).json();
    const c = await (await refresh(base, b.refreshToken)).json();
    const familyId = sessionByToken(pool, config, c.refreshToken).family_id;

    const reuse = await refresh(base, a.refreshToken);
    assert.equal(reuse.status, 401);
    const body = await reuse.json();
    assert.equal(body.error, 'unauthorized');
    assert.equal(JSON.stringify(body).includes(familyId), false);

    for (const row of pool._sessions.values()) {
      if (row.family_id === familyId) assert.ok(row.revoked_at);
    }
  });
});

test('reuse(B) after A->B->C revokes active tip C', async () => {
  await withServer(async ({ base, config, pool }) => {
    const a = await register(base, 'reuse-b@example.com');
    const b = await (await refresh(base, a.refreshToken)).json();
    const c = await (await refresh(base, b.refreshToken)).json();
    const familyId = sessionByToken(pool, config, c.refreshToken).family_id;

    const reuse = await refresh(base, b.refreshToken);
    assert.equal(reuse.status, 401);
    assert.equal((await reuse.json()).error, 'unauthorized');

    for (const row of pool._sessions.values()) {
      if (row.family_id === familyId) assert.ok(row.revoked_at);
    }
  });
});

test('revoked-family token is rejected', async () => {
  await withServer(async ({ base }) => {
    const a = await register(base, 'revoked-family@example.com');
    const b = await (await refresh(base, a.refreshToken)).json();
    await refresh(base, a.refreshToken);
    const again = await refresh(base, b.refreshToken);
    assert.equal(again.status, 401);
    assert.equal((await again.json()).error, 'unauthorized');
  });
});

test('logout revokes current session only; new login uses a new family', async () => {
  await withServer(async ({ base, config, pool }) => {
    const first = await register(base, 'logout-family@example.com');
    const family1 = sessionByToken(pool, config, first.refreshToken).family_id;

    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: first.refreshToken })
    });
    assert.equal(logout.status, 200);
    assert.ok(sessionByToken(pool, config, first.refreshToken).revoked_at);
    assert.equal(sessionByToken(pool, config, first.refreshToken).replaced_by_session_id, null);

    const second = await login(base, 'logout-family@example.com');
    const family2 = sessionByToken(pool, config, second.refreshToken).family_id;
    assert.notEqual(family1, family2);

    // Build old family rotation leftover then reuse — must not touch family2.
    // family1 already logged out; create an independent rotated family then reuse.
    const thirdLogin = await login(base, 'logout-family@example.com');
    const family3 = sessionByToken(pool, config, thirdLogin.refreshToken).family_id;
    const rotated = await rotateRefreshSession(pool, config, thirdLogin.refreshToken);
    const tip = sessionByToken(pool, config, rotated.refreshToken);
    assert.equal(tip.family_id, family3);

    const reuse = await refresh(base, thirdLogin.refreshToken);
    assert.equal(reuse.status, 401);

    // New login family after reuse should stay independent of prior families.
    const fourth = await login(base, 'logout-family@example.com');
    const family4 = sessionByToken(pool, config, fourth.refreshToken).family_id;
    await refresh(base, first.refreshToken);
    assert.equal(sessionByToken(pool, config, fourth.refreshToken).revoked_at, null);
    assert.notEqual(family4, family1);
    assert.notEqual(family4, family3);
    assert.equal(sessionByToken(pool, config, second.refreshToken).family_id, family2);
  });
});

test('sequential double refresh of A yields at most one active successor in family', async () => {
  await withServer(async ({ base, config, pool }) => {
    const a = await register(base, 'double@example.com');
    const first = await refresh(base, a.refreshToken);
    const second = await refresh(base, a.refreshToken);
    assert.equal(first.status, 200);
    assert.equal(second.status, 401);

    const familyId = sessionByToken(pool, config, a.refreshToken).family_id;
    const active = [...pool._sessions.values()].filter(
      (s) => s.family_id === familyId && s.revoked_at == null
    );
    // Strict reuse revoke may leave zero active sessions; never more than one.
    assert.ok(active.length <= 1);
  });
});
