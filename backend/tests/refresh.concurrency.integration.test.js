'use strict';

/**
 * INTEGRATION TEST — requires DATABASE_URL
 *
 * Proves PostgreSQL transaction locking for concurrent refresh of the same
 * credential. An in-memory pool cannot validate FOR UPDATE / unique-index
 * concurrency, so this test is skipped when DATABASE_URL is absent.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { createPool, query } = require('../src/db');
const { applyMigrations } = require('../src/db/migrate');
const { hashPassword } = require('../src/services/passwords');
const { createSession, rotateRefreshSession } = require('../src/services/sessions');

const config = loadConfig({
  ...process.env,
  ACCESS_TOKEN_SECRET:
    process.env.ACCESS_TOKEN_SECRET || 'test-access-secret-at-least-32-chars-long',
  REFRESH_TOKEN_SECRET:
    process.env.REFRESH_TOKEN_SECRET || 'test-refresh-secret-at-least-32-chars-long'
});
const hasDatabase = Boolean(config.databaseUrl);
const integration = hasDatabase ? test : test.skip;

integration(
  'INTEGRATION: concurrent refresh of one token yields at most one active family successor',
  async () => {
    const pool = createPool(config);
    try {
      await applyMigrations({ config, pool, logger: { log() {} } });

      const email = `concurrent-${Date.now()}@example.com`;
      const passwordHash = await hashPassword('correct-horse');
      const userInsert = await query(
        pool,
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id`,
        [email, passwordHash]
      );
      const userId = userInsert.rows[0].id;
      const initial = await createSession(pool, config, { userId });

      const results = await Promise.allSettled([
        rotateRefreshSession(pool, config, initial.refreshToken),
        rotateRefreshSession(pool, config, initial.refreshToken)
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.ok(fulfilled.length <= 1);
      assert.ok(rejected.length >= 1);

      const familyId = (
        await query(
          pool,
          `SELECT family_id FROM sessions WHERE id = $1`,
          [initial.session.id]
        )
      ).rows[0].family_id;

      const active = await query(
        pool,
        `SELECT id FROM sessions WHERE family_id = $1 AND revoked_at IS NULL`,
        [familyId]
      );
      assert.ok(active.rows.length <= 1);
    } finally {
      await pool.end();
    }
  }
);
