'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadConfig } = require('../src/config');
const { createRequestListener } = require('../src/routes');
const { hashPassword } = require('../src/services/passwords');
const { hashRefreshToken } = require('../src/services/tokens');
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
    AUTH_RATE_LIMIT_MAX: '1000'
  });
}

function createMemoryPool() {
  const users = new Map();
  const sessions = new Map();
  let userSeq = 0;
  let sessionSeq = 0;

  return {
    async query(text, params = []) {
      const sql = text.replace(/\s+/g, ' ').trim();

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
        const email = params[0];
        const row = [...users.values()].find((user) => user.email === email);
        return { rows: row ? [row] : [] };
      }

      if (sql.startsWith('SELECT id, email, email_verified, created_at FROM users WHERE id')) {
        const row = users.get(params[0]);
        return { rows: row ? [row] : [] };
      }

      if (sql.startsWith('INSERT INTO sessions')) {
        const [userId, refreshTokenHash, expiresAt, userAgent, ipAddress] = params;
        sessionSeq += 1;
        const id = `10000000-0000-4000-8000-${String(sessionSeq).padStart(12, '0')}`;
        const row = {
          id,
          user_id: userId,
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

      if (sql.startsWith('SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE refresh_token_hash')) {
        const row = [...sessions.values()].find((session) => session.refresh_token_hash === params[0]);
        return { rows: row ? [row] : [] };
      }

      if (sql.startsWith('SELECT id FROM sessions WHERE refresh_token_hash')) {
        const row = [...sessions.values()].find((session) => session.refresh_token_hash === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (sql.startsWith('UPDATE sessions SET revoked_at')) {
        const row = sessions.get(params[0]);
        if (row && !row.revoked_at) row.revoked_at = new Date().toISOString();
        return { rows: [] };
      }

      throw new Error(`Unhandled SQL in memory pool: ${sql}`);
    },
    _users: users,
    _sessions: sessions
  };
}

async function withServer(run) {
  const config = testConfig();
  const pool = createMemoryPool();
  // Bypass db.query sanitizer path by injecting pool used directly by services via getPool.
  // Services call query(pool, ...) which uses pool.query — our memory pool works.
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

test('registration validation rejects invalid email and short password', async () => {
  await withServer(async ({ base }) => {
    const invalidEmail = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'longenough' })
    });
    assert.equal(invalidEmail.status, 400);
    assert.equal((await invalidEmail.json()).error, 'invalid_email');

    const shortPassword = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ops@example.com', password: 'short' })
    });
    assert.equal(shortPassword.status, 400);
    assert.equal((await shortPassword.json()).error, 'invalid_password');
  });
});

test('register/login success, me endpoint, and safe login failure', async () => {
  await withServer(async ({ base, pool }) => {
    const register = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Ops@Example.com', password: 'correct-horse' })
    });
    assert.equal(register.status, 201);
    const registered = await register.json();
    assert.equal(registered.user.email, 'ops@example.com');
    assert.ok(registered.accessToken);
    assert.ok(registered.refreshToken);
    assert.equal(JSON.stringify(registered).includes('password'), false);
    assert.equal(JSON.stringify(registered).includes('password_hash'), false);

    const stored = [...pool._users.values()][0];
    assert.match(stored.password_hash, /^\$argon2id\$/);
    assert.notEqual(stored.password_hash, 'correct-horse');

    const loginOk = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ops@example.com', password: 'correct-horse' })
    });
    assert.equal(loginOk.status, 200);
    const loggedIn = await loginOk.json();

    const me = await fetch(`${base}/auth/me`, {
      headers: { authorization: `Bearer ${loggedIn.accessToken}` }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.email, 'ops@example.com');

    const loginBad = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ops@example.com', password: 'wrong-password' })
    });
    assert.equal(loginBad.status, 401);
    const badBody = await loginBad.json();
    assert.equal(badBody.error, 'invalid_credentials');
    assert.equal(JSON.stringify(badBody).includes('argon2'), false);
  });
});

test('refresh rotates tokens and rejects reused refresh token', async () => {
  await withServer(async ({ base, pool, config }) => {
    const register = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'rotate@example.com', password: 'correct-horse' })
    });
    const first = await register.json();
    const originalHash = hashRefreshToken(first.refreshToken, config.refreshTokenSecret);
    assert.ok([...pool._sessions.values()].some((s) => s.refresh_token_hash === originalHash));

    const refreshed = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: first.refreshToken })
    });
    assert.equal(refreshed.status, 200);
    const second = await refreshed.json();
    assert.notEqual(second.refreshToken, first.refreshToken);

    const oldSession = [...pool._sessions.values()].find((s) => s.refresh_token_hash === originalHash);
    assert.ok(oldSession.revoked_at);

    const reuse = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: first.refreshToken })
    });
    assert.equal(reuse.status, 401);
    assert.equal((await reuse.json()).error, 'session_revoked');
  });
});

test('logout revokes session and blocks later refresh', async () => {
  await withServer(async ({ base }) => {
    const register = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'logout@example.com', password: 'correct-horse' })
    });
    const session = await register.json();

    const logout = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    assert.equal(logout.status, 200);

    const refresh = await fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    assert.equal(refresh.status, 401);
  });
});

test('duplicate registration returns safe email_unavailable error', async () => {
  await withServer(async ({ base }) => {
    const body = { email: 'dup@example.com', password: 'correct-horse' };
    assert.equal(
      (
        await fetch(`${base}/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        })
      ).status,
      201
    );

    const dup = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).error, 'email_unavailable');
  });
});

// Keep hashPassword import used for direct assertion coverage in isolation.
test('hashPassword output is not reversible plaintext', async () => {
  const hash = await hashPassword('another-valid-password');
  assert.notEqual(hash, 'another-valid-password');
  assert.ok(!hash.includes('another-valid-password'));
  assert.ok(new AppError('x', { code: 'y' }));
});
