'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config');
const { createRequestListener } = require('../src/routes');
const {
  findOrCreateGoogleUser,
  assertGoogleIdentity,
  signOAuthState,
  completeGoogleOAuth,
  consumeExchangeCode,
  hashExchangeCode
} = require('../src/services/googleOAuth');

function googleConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://example',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    JWT_ISSUER: 'ghost-protocol-api-test',
    JWT_AUDIENCE: 'ghost-protocol-clients-test',
    FRONTEND_URL: 'https://ghost-protocol-pi.vercel.app',
    API_PUBLIC_URL: 'https://ghost-protocol-production-f7ef.up.railway.app',
    GOOGLE_CLIENT_ID: 'google-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'google-client-secret-value',
    GOOGLE_REDIRECT_URI:
      'https://ghost-protocol-production-f7ef.up.railway.app/auth/google/callback',
    AUTH_RATE_LIMIT_MAX: '1000',
    ...overrides
  });
}

function createMemoryPool() {
  const users = new Map();
  const sessions = new Map();
  const exchanges = new Map();
  const profiles = new Map();
  let userSeq = 0;
  let sessionSeq = 0;

  async function exec(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

    if (sql.startsWith('INSERT INTO users (email, password_hash, email_verified, google_sub)')) {
      const [email, , , googleSub] = params;
      // VALUES ($1, NULL, TRUE, $2) — password is null literal
      const emailArg = params[0];
      const googleSubArg = params[1];
      for (const user of users.values()) {
        if (user.email === emailArg || (googleSubArg && user.google_sub === googleSubArg)) {
          const error = new Error('duplicate');
          error.code = '23505';
          throw error;
        }
      }
      userSeq += 1;
      const id = `00000000-0000-4000-8000-${String(userSeq).padStart(12, '0')}`;
      const row = {
        id,
        email: emailArg,
        password_hash: null,
        email_verified: true,
        google_sub: googleSubArg,
        created_at: new Date().toISOString()
      };
      users.set(id, row);
      return { rows: [row] };
    }

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
        google_sub: null,
        created_at: new Date().toISOString()
      };
      users.set(id, row);
      return { rows: [row] };
    }

    if (sql.startsWith('SELECT id, email, password_hash, email_verified, google_sub, created_at FROM users WHERE google_sub')) {
      const row = [...users.values()].find((user) => user.google_sub === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT id, email, password_hash, email_verified, google_sub, created_at FROM users WHERE email')) {
      const row = [...users.values()].find((user) => user.email === params[0]);
      return { rows: row ? [row] : [] };
    }

    if (sql.startsWith('SELECT id FROM users WHERE email = $1 AND id <> $2')) {
      const row = [...users.values()].find((user) => user.email === params[0] && user.id !== params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (sql.startsWith('UPDATE users SET email_verified = TRUE')) {
      const user = users.get(params[0]);
      if (user) user.email_verified = true;
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE users SET google_sub')) {
      const user = users.get(params[0]);
      if (user && user.google_sub == null) {
        user.google_sub = params[1];
        user.email_verified = true;
      }
      return { rows: [] };
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

    if (sql.startsWith('INSERT INTO oauth_exchanges')) {
      const [codeHash, bundleJson, expiresAt] = params;
      exchanges.set(codeHash, {
        code_hash: codeHash,
        bundle_json: bundleJson,
        expires_at: expiresAt,
        consumed_at: null
      });
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE oauth_exchanges')) {
      const row = exchanges.get(params[0]);
      if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
        return { rows: [] };
      }
      row.consumed_at = new Date().toISOString();
      return { rows: [{ bundle_json: row.bundle_json }] };
    }

    if (sql.startsWith('INSERT INTO profiles')) {
      profiles.set(params[0], { user_id: params[0], name: params[1], avatar_url: params[2] });
      return { rows: [] };
    }

    throw new Error(`Unhandled SQL in google oauth test pool: ${sql}`);
  }

  return {
    query: exec,
    connect: async () => ({
      query: exec,
      release() {}
    }),
    _users: users,
    _sessions: sessions,
    _exchanges: exchanges
  };
}

function fakeIdToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

test('assertGoogleIdentity requires verified email, iss, aud, sub', () => {
  const config = googleConfig();
  const identity = assertGoogleIdentity(config, {
    iss: 'https://accounts.google.com',
    aud: config.googleClientId,
    sub: 'google-sub-1',
    email: 'Operative@Example.COM',
    email_verified: true,
    name: 'Operative',
    picture: 'https://lh3.googleusercontent.com/a/x'
  });
  assert.equal(identity.email, 'operative@example.com');
  assert.equal(identity.googleSub, 'google-sub-1');
  assert.throws(
    () =>
      assertGoogleIdentity(config, {
        iss: 'https://evil.example',
        aud: config.googleClientId,
        sub: 'x',
        email: 'a@b.com',
        email_verified: true
      }),
    /issuer/i
  );
  assert.throws(
    () =>
      assertGoogleIdentity(config, {
        iss: 'https://accounts.google.com',
        aud: 'wrong',
        sub: 'x',
        email: 'a@b.com',
        email_verified: true
      }),
    /audience/i
  );
  assert.throws(
    () =>
      assertGoogleIdentity(config, {
        iss: 'https://accounts.google.com',
        aud: config.googleClientId,
        sub: 'x',
        email: 'a@b.com',
        email_verified: false
      }),
    /not verified/i
  );
});

test('Google sign-up creates passwordless user; sign-in reuses google_sub', async () => {
  const pool = createMemoryPool();
  const first = await findOrCreateGoogleUser(pool, {
    googleSub: 'sub-new',
    email: 'new@example.com',
    name: 'New',
    picture: null
  });
  assert.equal(first.created, true);
  assert.equal(first.user.email, 'new@example.com');
  assert.equal(first.user.emailVerified, true);
  const stored = [...pool._users.values()][0];
  assert.equal(stored.password_hash, null);
  assert.equal(stored.google_sub, 'sub-new');

  const second = await findOrCreateGoogleUser(pool, {
    googleSub: 'sub-new',
    email: 'new@example.com',
    name: 'New',
    picture: null
  });
  assert.equal(second.created, false);
  assert.equal(second.user.id, first.user.id);
});

test('duplicate email links google_sub once; never second account; mismatch rejected', async () => {
  const pool = createMemoryPool();
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified, created_at`,
    ['dup@example.com', '$argon2id$existing']
  );

  const linked = await findOrCreateGoogleUser(pool, {
    googleSub: 'sub-link',
    email: 'dup@example.com',
    name: null,
    picture: null
  });
  assert.equal(linked.created, false);
  assert.equal(linked.linked, true);
  assert.equal([...pool._users.values()].length, 1);
  assert.equal([...pool._users.values()][0].google_sub, 'sub-link');

  await assert.rejects(
    () =>
      findOrCreateGoogleUser(pool, {
        googleSub: 'other-sub',
        email: 'dup@example.com',
        name: null,
        picture: null
      }),
    (error) => error.code === 'google_account_mismatch'
  );
});

test('complete Google OAuth issues exchange code and session tokens', async () => {
  const config = googleConfig();
  const pool = createMemoryPool();
  const state = await signOAuthState(config, {
    typ: 'google_oauth_state',
    nonce: 'n1',
    returnTo: 'https://ghost-protocol-pi.vercel.app/',
    platform: 'web'
  });

  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        id_token: fakeIdToken({
          iss: 'https://accounts.google.com',
          aud: config.googleClientId,
          sub: 'sub-flow',
          email: 'flow@example.com',
          email_verified: true,
          exp: Math.floor(Date.now() / 1000) + 3600
        })
      };
    }
  });

  const completed = await completeGoogleOAuth(pool, config, {
    code: 'auth-code',
    state,
    fetchImpl
  });
  assert.match(completed.redirectTo, /^https:\/\/ghost-protocol-pi\.vercel\.app\/\?/);
  const redirect = new URL(completed.redirectTo);
  const exchange = redirect.searchParams.get('google_exchange');
  assert.ok(exchange);

  const bundle = await consumeExchangeCode(pool, exchange);
  assert.ok(bundle.accessToken);
  assert.ok(bundle.refreshToken);
  assert.equal(bundle.user.email, 'flow@example.com');
  assert.equal(pool._sessions.size, 1);

  await assert.rejects(() => consumeExchangeCode(pool, exchange), /expired|Invalid/);
});

test('invalid OAuth state and Google cancel redirect cleanly to frontend', async () => {
  const config = googleConfig();
  const pool = createMemoryPool();
  const state = await signOAuthState(config, {
    typ: 'google_oauth_state',
    nonce: 'n2',
    returnTo: 'https://ghost-protocol-pi.vercel.app/',
    platform: 'web'
  });

  const cancelled = await completeGoogleOAuth(pool, config, {
    state,
    error: 'access_denied'
  });
  assert.match(cancelled.redirectTo, /google_error=google_cancelled/);

  await assert.rejects(
    () =>
      completeGoogleOAuth(pool, config, {
        code: 'x',
        state: 'not-a-jwt'
      }),
    (error) => error.code === 'invalid_oauth_state'
  );
});

test('GET /auth/google redirects to Google; exchange endpoint returns tokens', async () => {
  const config = googleConfig();
  const pool = createMemoryPool();
  const server = http.createServer(
    createRequestListener(config, {
      getPool: () => pool,
      checkDb: async () => true,
      fetchImpl: async () => ({ ok: true, async json() { return {}; } })
    })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const start = await fetch(
      `http://127.0.0.1:${port}/auth/google?return_to=${encodeURIComponent('https://ghost-protocol-pi.vercel.app/')}`,
      { redirect: 'manual' }
    );
    assert.equal(start.status, 302);
    const location = start.headers.get('location');
    assert.match(location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    const googleUrl = new URL(location);
    assert.equal(googleUrl.searchParams.get('client_id'), config.googleClientId);
    assert.equal(
      googleUrl.searchParams.get('redirect_uri'),
      'https://ghost-protocol-production-f7ef.up.railway.app/auth/google/callback'
    );
    assert.ok(googleUrl.searchParams.get('state'));

    // Seed an exchange row directly
    const code = crypto.randomBytes(16).toString('base64url');
    await pool.query(
      `INSERT INTO oauth_exchanges (code_hash, bundle_json, expires_at) VALUES ($1, $2, $3)`,
      [
        hashExchangeCode(code),
        JSON.stringify({
          accessToken: 'access',
          refreshToken: 'refresh',
          tokenType: 'Bearer',
          expiresIn: 900,
          session: { id: 's1', expiresAt: new Date().toISOString() },
          user: { id: 'u1', email: 'x@example.com', emailVerified: true, createdAt: new Date().toISOString() }
        }),
        new Date(Date.now() + 60_000).toISOString()
      ]
    );

    const exchanged = await fetch(`http://127.0.0.1:${port}/auth/google/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://ghost-protocol-pi.vercel.app' },
      body: JSON.stringify({ exchangeCode: code })
    });
    assert.equal(exchanged.status, 200);
    const body = await exchanged.json();
    assert.equal(body.accessToken, 'access');
    assert.equal(body.refreshToken, 'refresh');
    assert.equal(exchanged.headers.get('access-control-allow-origin'), 'https://ghost-protocol-pi.vercel.app');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('production Google redirect URI is derived from API_PUBLIC_URL', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    API_PUBLIC_URL: 'https://ghost-protocol-production-f7ef.up.railway.app/',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret'
  });
  assert.equal(
    config.googleRedirectUri,
    'https://ghost-protocol-production-f7ef.up.railway.app/auth/google/callback'
  );
});
