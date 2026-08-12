'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SignJWT } = require('jose');
const { loadConfig } = require('../src/config');
const { AppError, toClientError } = require('../src/errors');
const {
  hashPassword,
  verifyPassword,
  ARGON2_OPTIONS
} = require('../src/services/passwords');
const {
  createAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken
} = require('../src/services/tokens');
const { createRequireAuth } = require('../src/middleware/auth');
const { createRequestListener } = require('../src/routes');
const argon2 = require('argon2');

function testConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '3000',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long',
    JWT_ISSUER: 'ghost-protocol-api-test',
    JWT_AUDIENCE: 'ghost-protocol-clients-test',
    ACCESS_TOKEN_TTL_SECONDS: '60',
    REFRESH_TOKEN_TTL_SECONDS: '3600',
    ...overrides
  });
}

test('password hashing uses Argon2id and verifies correctly', async () => {
  assert.equal(ARGON2_OPTIONS.type, argon2.argon2id);
  const hash = await hashPassword('correct-horse-battery');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'correct-horse-battery'), true);
  assert.equal(await verifyPassword(hash, 'wrong-password'), false);
});

test('password hashing rejects too-short passwords', async () => {
  await assert.rejects(
    () => hashPassword('short'),
    (error) => error instanceof AppError && error.code === 'invalid_password'
  );
});

test('access tokens include iss/aud/exp and verify successfully', async () => {
  const config = testConfig();
  const token = await createAccessToken(config, {
    userId: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222'
  });

  const auth = await verifyAccessToken(config, token);
  assert.equal(auth.userId, '11111111-1111-1111-1111-111111111111');
  assert.equal(auth.sessionId, '22222222-2222-2222-2222-222222222222');
});

test('access token verification rejects expired tokens', async () => {
  const config = testConfig({ ACCESS_TOKEN_TTL_SECONDS: '1' });
  const token = await createAccessToken(config, {
    userId: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222'
  });

  // Force an already-expired token.
  const expired = await new SignJWT({ sid: '22222222-2222-2222-2222-222222222222', typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-1111-1111-1111-111111111111')
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(config.accessTokenSecret));

  await assert.rejects(
    () => verifyAccessToken(config, expired),
    (error) => error instanceof AppError && error.code === 'token_expired'
  );
  assert.ok(token);
});

test('access token verification rejects malformed tokens', async () => {
  const config = testConfig();
  await assert.rejects(
    () => verifyAccessToken(config, 'not-a-jwt'),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
});

test('access token verification rejects wrong issuer and audience', async () => {
  const config = testConfig();
  const wrongIssuer = await new SignJWT({ sid: 's', typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u')
    .setIssuer('other-issuer')
    .setAudience(config.jwtAudience)
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(config.accessTokenSecret));

  const wrongAudience = await new SignJWT({ sid: 's', typ: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u')
    .setIssuer(config.jwtIssuer)
    .setAudience('other-audience')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(config.accessTokenSecret));

  await assert.rejects(
    () => verifyAccessToken(config, wrongIssuer),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
  await assert.rejects(
    () => verifyAccessToken(config, wrongAudience),
    (error) => error instanceof AppError && error.code === 'unauthorized'
  );
});

test('refresh tokens are hashed and never equal plaintext', () => {
  const config = testConfig();
  const token = generateRefreshToken();
  const hashed = hashRefreshToken(token, config.refreshTokenSecret);
  assert.notEqual(token, hashed);
  assert.equal(hashed.length, 64);
  assert.equal(hashRefreshToken(token, config.refreshTokenSecret), hashed);
});

test('toClientError never exposes secrets or stacks', () => {
  const mapped = toClientError(new Error('postgresql://user:pass@host/db boom'));
  assert.equal(mapped.status, 500);
  assert.deepEqual(mapped.body, {
    error: 'internal_error',
    message: 'An unexpected error occurred'
  });
  assert.equal(JSON.stringify(mapped).includes('pass'), false);
});

test('requireAuth derives identity from validated token only', async () => {
  const config = testConfig();
  const requireAuth = createRequireAuth(config);
  const token = await createAccessToken(config, {
    userId: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222'
  });

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {
    statusCode: 0,
    body: null,
    writeHead(code) {
      this.statusCode = code;
    },
    end(payload) {
      this.body = JSON.parse(payload);
    }
  };

  const ok = await requireAuth(req, res);
  assert.equal(ok, true);
  assert.equal(req.auth.userId, '11111111-1111-1111-1111-111111111111');
  assert.equal(req.auth.sessionId, '22222222-2222-2222-2222-222222222222');
});

test('protected route rejects missing Authorization without trusting body user_id', async () => {
  const config = testConfig({
    DATABASE_URL: 'postgresql://example',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long'
  });

  const server = http.createServer(
    createRequestListener(config, {
      checkDb: async () => false,
      getPool: () => {
        throw new Error('pool should not be used without auth');
      }
    })
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/auth/me`, {
      headers: { 'x-user-id': 'attacker' }
    });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error, 'unauthorized');
    assert.equal(JSON.stringify(body).includes('attacker'), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('GET /health reports phase 3 and authConfigured', async () => {
  const config = testConfig();
  const server = http.createServer(
    createRequestListener(config, { checkDb: async () => false })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.phase, 3);
    assert.equal(body.authConfigured, true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
