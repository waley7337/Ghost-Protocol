'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequestListener } = require('../src/routes');
const { loadConfig, requireDatabaseUrl, ConfigError } = require('../src/config');
const {
  sanitizeDbError,
  shouldUseSsl,
  buildPoolConfig,
  query,
  DatabaseError
} = require('../src/db');
const { listMigrationFiles, DEFAULT_MIGRATIONS_DIR } = require('../src/db/migrate');

test('GET /health returns phase 2 scaffold payload', async () => {
  const server = http.createServer(
    createRequestListener({ nodeEnv: 'test', port: 0, databaseUrl: null })
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'ghost-protocol-api');
    assert.equal(body.phase, 2);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('GET /health/db returns unavailable without exposing internals', async () => {
  const server = http.createServer(
    createRequestListener(
      { nodeEnv: 'test', port: 0, databaseUrl: null },
      {
        checkDb: async () => {
          throw new Error('postgresql://user:secret@db.example/ghost host details');
        }
      }
    )
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/db`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(body, { error: 'internal_error' });
    assert.equal(JSON.stringify(body).includes('secret'), false);
    assert.equal(JSON.stringify(body).includes('postgresql'), false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('GET /health/db maps connectivity to ok/unavailable only', async () => {
  const server = http.createServer(
    createRequestListener(
      { nodeEnv: 'test', port: 0, databaseUrl: 'postgresql://example' },
      { checkDb: async () => false }
    )
  );

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/db`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('migration files are ordered deterministically by numeric prefix', () => {
  const files = listMigrationFiles(DEFAULT_MIGRATIONS_DIR);
  assert.deepEqual(files, [
    '001_create_users.sql',
    '002_create_sessions.sql',
    '003_create_profiles.sql',
    '004_create_user_progress.sql'
  ]);
  assert.deepEqual([...files].sort((a, b) => a.localeCompare(b, 'en')), files);
});

test('migration SQL enforces ownership FKs and hashed session credential column', () => {
  const fs = require('node:fs');
  const stripSqlComments = (sql) =>
    sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

  const users = stripSqlComments(
    fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '001_create_users.sql'), 'utf8')
  );
  const sessions = stripSqlComments(
    fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '002_create_sessions.sql'), 'utf8')
  );
  const profiles = stripSqlComments(
    fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '003_create_profiles.sql'), 'utf8')
  );
  const progress = stripSqlComments(
    fs.readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, '004_create_user_progress.sql'), 'utf8')
  );

  assert.match(users, /CREATE TABLE users/i);
  assert.match(users, /password_hash/i);
  assert.match(users, /users_email_normalized/i);

  assert.match(sessions, /refresh_token_hash/i);
  assert.match(sessions, /REFERENCES users \(id\) ON DELETE CASCADE/i);
  assert.doesNotMatch(sessions, /^\s*refresh_token\s+TEXT/im);

  assert.match(profiles, /user_id UUID PRIMARY KEY REFERENCES users \(id\) ON DELETE CASCADE/i);
  assert.doesNotMatch(profiles, /\bemail\b/i);

  assert.match(progress, /progress JSONB/i);
  assert.match(progress, /REFERENCES users \(id\) ON DELETE CASCADE/i);
});

test('requireDatabaseUrl rejects missing configuration', () => {
  assert.throws(
    () => requireDatabaseUrl(loadConfig({ NODE_ENV: 'test' })),
    (error) => error instanceof ConfigError
  );
});

test('sanitizeDbError never returns connection strings or credentials', () => {
  const dirty = new Error('connect ECONNREFUSED postgresql://ghost:s3cret@db.internal:5432/ghost');
  dirty.code = 'ECONNREFUSED';
  const clean = sanitizeDbError(dirty);
  assert.equal(clean instanceof DatabaseError, true);
  assert.equal(clean.message, 'A database error occurred');
  assert.equal(clean.message.includes('s3cret'), false);
  assert.equal(clean.message.includes('postgresql://'), false);
  assert.equal(clean.code, 'ECONNREFUSED');
});

test('buildPoolConfig enables TLS for production by default with cert validation on', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '8080',
    DATABASE_URL: 'postgresql://ghost_app:CHANGE_ME@db.example:5432/ghost_protocol'
  });
  assert.equal(shouldUseSsl(config), true);
  const poolConfig = buildPoolConfig(config);
  assert.equal(typeof poolConfig.ssl, 'object');
  assert.equal(poolConfig.ssl.rejectUnauthorized, true);
});

test('assertProductionConfig requires DATABASE_URL and rejects client-exposed DB vars', () => {
  const { assertProductionConfig } = require('../src/config');
  assert.throws(
    () =>
      assertProductionConfig(
        loadConfig({ NODE_ENV: 'production', PORT: '3000' })
      ),
    (error) => error instanceof ConfigError
  );

  const previousVite = process.env.VITE_DATABASE_URL;
  process.env.VITE_DATABASE_URL = 'postgresql://should-not-exist';
  try {
    assert.throws(
      () =>
        assertProductionConfig(
          loadConfig({
            NODE_ENV: 'production',
            PORT: '3000',
            DATABASE_URL: 'postgresql://ghost_app:CHANGE_ME@db.example:5432/ghost'
          })
        ),
      (error) => error instanceof ConfigError && /Client-exposed/.test(error.message)
    );
  } finally {
    if (previousVite === undefined) delete process.env.VITE_DATABASE_URL;
    else process.env.VITE_DATABASE_URL = previousVite;
  }
});

test('production loadConfig requires PORT from the environment', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@h:5432/db' }),
    (error) => error instanceof ConfigError && /PORT/.test(error.message)
  );

  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '4567',
    DATABASE_URL: 'postgresql://u:p@h:5432/db'
  });
  assert.equal(config.port, 4567);
  assert.equal(config.host, '0.0.0.0');
});

test('query helper requires parameterized values as an array', async () => {
  const fakePool = {
    async query() {
      return { rows: [] };
    }
  };

  await assert.rejects(
    () => query(fakePool, 'SELECT 1', 'not-an-array'),
    (error) => error instanceof DatabaseError && error.code === 'INVALID_PARAMS'
  );

  let seenText;
  let seenParams;
  const recordingPool = {
    async query(text, params) {
      seenText = text;
      seenParams = params;
      return { rows: [{ ok: 1 }] };
    }
  };

  await query(recordingPool, 'SELECT $1::int AS ok', [1]);
  assert.equal(seenText, 'SELECT $1::int AS ok');
  assert.deepEqual(seenParams, [1]);
});
