'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = require('jose');
const { loadConfig } = require('../src/config');
const { createRequestListener } = require('../src/routes');
const {
  findOrCreateGoogleUser,
  assertGoogleIdentity,
  signOAuthState,
  completeGoogleOAuth,
  consumeExchangeCode,
  hashExchangeCode,
  verifyGoogleIdToken,
  buildGoogleAuthorizeUrl,
  startGoogleOAuth
} = require('../src/services/googleOAuth');

let testJwks;
let testPrivateKey;
let testKid = 'ghost-test-google-key';

test.before(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  testPrivateKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.alg = 'RS256';
  jwk.kid = testKid;
  jwk.use = 'sig';
  testJwks = createLocalJWKSet({ keys: [jwk] });
});

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

    // Auto-link UPDATE path removed (H1 / WP2); keep no-op mismatch if an old query appears.
    if (sql.startsWith('UPDATE users SET google_sub')) {
      throw new Error('google_sub auto-link UPDATE must not be used');
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
  // Legacy unsigned placeholder — must be rejected by JWKS verification.
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

async function signedGoogleIdToken(config, claims) {
  return new SignJWT({
    email_verified: true,
    ...claims
  })
    .setProtectedHeader({ alg: 'RS256', kid: testKid, typ: 'JWT' })
    .setIssuer('https://accounts.google.com')
    .setAudience(config.googleClientId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject(claims.sub)
    .sign(testPrivateKey);
}

function parseFragmentParams(redirectTo) {
  const url = new URL(redirectTo);
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash || '');
}

test('verifyGoogleIdToken: correct nonce accepted', async () => {
  const config = googleConfig();
  const token = await signedGoogleIdToken(config, {
    sub: 'sub-ok',
    email: 'ok@example.com',
    nonce: 'nonce-ok'
  });
  const identity = await verifyGoogleIdToken(config, token, {
    expectedNonce: 'nonce-ok',
    jwks: testJwks
  });
  assert.equal(identity.googleSub, 'sub-ok');
  assert.equal(identity.email, 'ok@example.com');
});

test('verifyGoogleIdToken: bad signature rejected', async () => {
  const config = googleConfig();
  const { privateKey: otherKey } = await generateKeyPair('RS256');
  const tampered = await new SignJWT({
    email: 'bad-sig@example.com',
    email_verified: true,
    nonce: 'n'
  })
    .setProtectedHeader({ alg: 'RS256', kid: testKid, typ: 'JWT' })
    .setIssuer('https://accounts.google.com')
    .setAudience(config.googleClientId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject('sub-bad-sig')
    .sign(otherKey);

  await assert.rejects(
    () => verifyGoogleIdToken(config, tampered, { expectedNonce: 'n', jwks: testJwks }),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('verifyGoogleIdToken: unsigned alg:none rejected', async () => {
  const config = googleConfig();
  await assert.rejects(
    () =>
      verifyGoogleIdToken(
        config,
        fakeIdToken({
          iss: 'https://accounts.google.com',
          aud: config.googleClientId,
          sub: 'x',
          email: 'a@b.com',
          email_verified: true,
          nonce: 'n',
          exp: Math.floor(Date.now() / 1000) + 3600
        }),
        { expectedNonce: 'n', jwks: testJwks }
      ),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('verifyGoogleIdToken: wrong audience rejected', async () => {
  const config = googleConfig();
  const token = await new SignJWT({
    email: 'aud@example.com',
    email_verified: true,
    nonce: 'n-aud'
  })
    .setProtectedHeader({ alg: 'RS256', kid: testKid, typ: 'JWT' })
    .setIssuer('https://accounts.google.com')
    .setAudience('wrong-audience.apps.googleusercontent.com')
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject('sub-aud')
    .sign(testPrivateKey);

  await assert.rejects(
    () => verifyGoogleIdToken(config, token, { expectedNonce: 'n-aud', jwks: testJwks }),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('verifyGoogleIdToken: wrong issuer rejected', async () => {
  const config = googleConfig();
  const token = await new SignJWT({
    email: 'iss@example.com',
    email_verified: true,
    nonce: 'n-iss'
  })
    .setProtectedHeader({ alg: 'RS256', kid: testKid, typ: 'JWT' })
    .setIssuer('https://evil.example')
    .setAudience(config.googleClientId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject('sub-iss')
    .sign(testPrivateKey);

  await assert.rejects(
    () => verifyGoogleIdToken(config, token, { expectedNonce: 'n-iss', jwks: testJwks }),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('verifyGoogleIdToken: expired token rejected', async () => {
  const config = googleConfig();
  const token = await new SignJWT({
    email: 'exp@example.com',
    email_verified: true,
    nonce: 'n-exp'
  })
    .setProtectedHeader({ alg: 'RS256', kid: testKid, typ: 'JWT' })
    .setIssuer('https://accounts.google.com')
    .setAudience(config.googleClientId)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .setSubject('sub-exp')
    .sign(testPrivateKey);

  await assert.rejects(
    () => verifyGoogleIdToken(config, token, { expectedNonce: 'n-exp', jwks: testJwks }),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('verifyGoogleIdToken: missing nonce rejected when expected', async () => {
  const config = googleConfig();
  const token = await signedGoogleIdToken(config, {
    sub: 'sub-missing-nonce',
    email: 'missing-nonce@example.com'
    // no nonce claim
  });
  await assert.rejects(
    () =>
      verifyGoogleIdToken(config, token, {
        expectedNonce: 'nonce-required',
        jwks: testJwks
      }),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('verifyGoogleIdToken: wrong nonce rejected', async () => {
  const config = googleConfig();
  const token = await signedGoogleIdToken(config, {
    sub: 'sub-wrong-nonce',
    email: 'wrong-nonce@example.com',
    nonce: 'nonce-a'
  });
  await assert.rejects(
    () =>
      verifyGoogleIdToken(config, token, {
        expectedNonce: 'nonce-b',
        jwks: testJwks
      }),
    (error) => error.code === 'google_identity_invalid'
  );
});

test('exchange code replay is rejected after first consume', async () => {
  const config = googleConfig();
  const pool = createMemoryPool();
  const state = await signOAuthState(config, {
    typ: 'google_oauth_state',
    nonce: 'n-replay',
    returnTo: 'https://ghost-protocol-pi.vercel.app/',
    platform: 'web'
  });
  const idToken = await signedGoogleIdToken(config, {
    sub: 'sub-replay',
    email: 'replay@example.com',
    nonce: 'n-replay'
  });
  const completed = await completeGoogleOAuth(pool, config, {
    code: 'auth-code-replay',
    state,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { id_token: idToken };
      }
    }),
    jwks: testJwks
  });
  const exchange = parseFragmentParams(completed.redirectTo).get('google_exchange');
  assert.ok(exchange);
  const first = await consumeExchangeCode(pool, exchange);
  assert.ok(first.accessToken);
  await assert.rejects(
    () => consumeExchangeCode(pool, exchange),
    (error) => error.code === 'invalid_exchange_code'
  );
});

test('startGoogleOAuth includes OpenID nonce in authorize URL', async () => {
  const config = googleConfig();
  const started = await startGoogleOAuth(config, {
    returnTo: 'https://ghost-protocol-pi.vercel.app/'
  });
  const url = new URL(started.url);
  assert.ok(url.searchParams.get('nonce'));
  assert.ok(url.searchParams.get('state'));
  const built = buildGoogleAuthorizeUrl(config, 'state-value', { nonce: 'n-explicit' });
  assert.equal(new URL(built).searchParams.get('nonce'), 'n-explicit');
});

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

test('existing linked Google identity signs in without creating a second user', async () => {
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
  assert.equal(second.linked, false);
  assert.equal(second.user.id, first.user.id);
  assert.equal([...pool._users.values()].length, 1);
});

test('new Google identity with unused email creates passwordless Google-backed account', async () => {
  const pool = createMemoryPool();
  const created = await findOrCreateGoogleUser(pool, {
    googleSub: 'sub-fresh',
    email: 'fresh@example.com',
    name: 'Fresh',
    picture: null
  });
  assert.equal(created.created, true);
  assert.equal(created.linked, false);
  assert.equal(created.user.email, 'fresh@example.com');
  assert.equal([...pool._users.values()][0].google_sub, 'sub-fresh');
  assert.equal([...pool._users.values()][0].password_hash, null);
});

test('existing password account with matching Google email refuses auto-link', async () => {
  const pool = createMemoryPool();
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified, created_at`,
    ['dup@example.com', '$argon2id$existing']
  );

  await assert.rejects(
    () =>
      findOrCreateGoogleUser(pool, {
        googleSub: 'sub-link',
        email: 'dup@example.com',
        name: null,
        picture: null
      }),
    (error) =>
      error.code === 'account_conflict' &&
      /existing method/i.test(error.message) &&
      !/password|unverified|google_sub/i.test(error.message)
  );

  const row = [...pool._users.values()][0];
  assert.equal(row.google_sub, null);
  assert.equal(row.email_verified, false);
  assert.equal(row.password_hash, '$argon2id$existing');
  assert.equal([...pool._users.values()].length, 1);
});

test('normalized case-insensitive email collision refuses auto-link', async () => {
  const pool = createMemoryPool();
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified, created_at`,
    ['victim@example.com', '$argon2id$existing']
  );

  await assert.rejects(
    () =>
      findOrCreateGoogleUser(pool, {
        googleSub: 'sub-case',
        email: 'Victim@Example.com',
        name: null,
        picture: null
      }),
    (error) => error.code === 'account_conflict'
  );

  // assertGoogleIdentity normalizes before findOrCreate; exercise that path too.
  const config = googleConfig();
  const identity = assertGoogleIdentity(config, {
    iss: 'https://accounts.google.com',
    aud: config.googleClientId,
    sub: 'sub-case-2',
    email: 'VICTIM@EXAMPLE.COM',
    email_verified: true
  });
  assert.equal(identity.email, 'victim@example.com');
  await assert.rejects(
    () => findOrCreateGoogleUser(pool, identity),
    (error) => error.code === 'account_conflict'
  );
  assert.equal([...pool._users.values()][0].google_sub, null);
});

test('email already linked to a different Google subject returns neutral conflict', async () => {
  const pool = createMemoryPool();
  await findOrCreateGoogleUser(pool, {
    googleSub: 'sub-original',
    email: 'taken@example.com',
    name: null,
    picture: null
  });

  await assert.rejects(
    () =>
      findOrCreateGoogleUser(pool, {
        googleSub: 'sub-other',
        email: 'taken@example.com',
        name: null,
        picture: null
      }),
    (error) => error.code === 'account_conflict'
  );
  assert.equal([...pool._users.values()].length, 1);
  assert.equal([...pool._users.values()][0].google_sub, 'sub-original');
});

test('repeated callbacks / unique race reuses google_sub winner; never auto-links password row', async () => {
  const pool = createMemoryPool();

  const [a, b] = await Promise.all([
    findOrCreateGoogleUser(pool, {
      googleSub: 'sub-race',
      email: 'race@example.com',
      name: null,
      picture: null
    }),
    findOrCreateGoogleUser(pool, {
      googleSub: 'sub-race',
      email: 'race@example.com',
      name: null,
      picture: null
    })
  ]);

  assert.equal(a.user.id, b.user.id);
  assert.equal([...pool._users.values()].length, 1);
  assert.equal([...pool._users.values()][0].google_sub, 'sub-race');

  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified, created_at`,
    ['race-pass@example.com', '$argon2id$existing']
  );

  // Simulate INSERT unique race against existing email: first create would 23505.
  await assert.rejects(
    () =>
      findOrCreateGoogleUser(pool, {
        googleSub: 'sub-race-pass',
        email: 'race-pass@example.com',
        name: null,
        picture: null
      }),
    (error) => error.code === 'account_conflict'
  );
  assert.equal(
    [...pool._users.values()].find((u) => u.email === 'race-pass@example.com').google_sub,
    null
  );
});

test('complete Google OAuth issues no session on account conflict', async () => {
  const config = googleConfig();
  const pool = createMemoryPool();
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified, created_at`,
    ['conflict@example.com', '$argon2id$existing']
  );

  const state = await signOAuthState(config, {
    typ: 'google_oauth_state',
    nonce: 'n-conflict',
    returnTo: 'https://ghost-protocol-pi.vercel.app/',
    platform: 'web'
  });

  const idToken = await signedGoogleIdToken(config, {
    sub: 'sub-conflict',
    email: 'conflict@example.com',
    nonce: 'n-conflict'
  });

  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { id_token: idToken };
    }
  });

  const completed = await completeGoogleOAuth(pool, config, {
    code: 'auth-code',
    state,
    fetchImpl,
    jwks: testJwks
  });

  const redirect = new URL(completed.redirectTo);
  assert.equal(redirect.search, '');
  const fragment = parseFragmentParams(completed.redirectTo);
  assert.equal(fragment.get('google_error'), 'account_conflict');
  assert.equal(fragment.get('google_error_message'), null);
  assert.equal(fragment.get('google_exchange'), null);
  assert.equal(pool._sessions.size, 0);
  assert.equal(pool._exchanges.size, 0);
  assert.equal([...pool._users.values()][0].google_sub, null);
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

  const idToken = await signedGoogleIdToken(config, {
    sub: 'sub-flow',
    email: 'flow@example.com',
    nonce: 'n1'
  });

  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { id_token: idToken };
    }
  });

  const completed = await completeGoogleOAuth(pool, config, {
    code: 'auth-code',
    state,
    fetchImpl,
    jwks: testJwks
  });
  assert.match(completed.redirectTo, /^https:\/\/ghost-protocol-pi\.vercel\.app\/#/);
  const redirect = new URL(completed.redirectTo);
  assert.equal(redirect.search, '');
  const fragment = parseFragmentParams(completed.redirectTo);
  const exchange = fragment.get('google_exchange');
  assert.ok(exchange);
  assert.equal(fragment.get('google_error'), null);

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
  assert.match(cancelled.redirectTo, /#.*google_error=google_cancelled/);
  assert.doesNotMatch(cancelled.redirectTo, /google_error_message=/);

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
    assert.ok(googleUrl.searchParams.get('nonce'));

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

test('GET /auth/google returns 503 google_not_configured when Google env is missing', async () => {
  const bare = loadConfig({
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://example',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    FRONTEND_URL: 'https://ghost-protocol-pi.vercel.app',
    API_PUBLIC_URL: 'https://ghost-protocol-production-f7ef.up.railway.app',
    AUTH_RATE_LIMIT_MAX: '1000'
  });
  assert.equal(bare.googleClientId, null);
  assert.equal(bare.googleClientSecret, null);

  const server = http.createServer(
    createRequestListener(bare, {
      checkDb: async () => true,
      getPool: () => {
        throw new Error('pool should not be used when Google is not configured');
      }
    })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/auth/google`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'google_not_configured');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
