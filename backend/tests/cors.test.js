'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequestListener } = require('../src/routes');
const { parseAllowedOrigins, resolveAllowedOrigin } = require('../src/middleware/cors');

function testConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    databaseUrl: null,
    frontendUrl: 'https://app.example',
    accessTokenSecret: 'test-access-secret-at-least-32-chars-long',
    refreshTokenSecret: 'test-refresh-secret-at-least-32-chars-long',
    jwtIssuer: 'ghost-protocol-api-test',
    jwtAudience: 'ghost-protocol-clients-test',
    authRateLimitWindowMs: 60000,
    authRateLimitMax: 100,
    trustProxy: false,
    jsonBodyLimitBytes: 16384,
    ...overrides
  };
}

test('parseAllowedOrigins includes FRONTEND_URL and local defaults in non-production', () => {
  const origins = parseAllowedOrigins(testConfig());
  assert.equal(origins.has('https://app.example'), true);
  assert.equal(origins.has('http://127.0.0.1:4173'), true);
});

test('production CORS does not auto-allow local preview origins', () => {
  const origins = parseAllowedOrigins(
    testConfig({ isProduction: true, frontendUrl: 'https://app.example' })
  );
  assert.equal(origins.has('https://app.example'), true);
  assert.equal(origins.has('http://127.0.0.1:4173'), false);
});

test('resolveAllowedOrigin rejects unknown origins', () => {
  const config = testConfig({ frontendUrl: 'https://app.example' });
  assert.equal(
    resolveAllowedOrigin({ headers: { origin: 'https://evil.example' } }, config),
    null
  );
  assert.equal(
    resolveAllowedOrigin({ headers: { origin: 'https://app.example' } }, config),
    'https://app.example'
  );
});

test('OPTIONS preflight and GET /health emit CORS for allowlisted origin', async () => {
  const server = http.createServer(
    createRequestListener(testConfig({ frontendUrl: 'https://app.example' }), {
      checkDb: async () => false
    })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const preflight = await fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/);

    const health = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: 'https://app.example' }
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), 'https://app.example');

    const blocked = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: 'https://evil.example' }
    });
    assert.equal(blocked.status, 200);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
