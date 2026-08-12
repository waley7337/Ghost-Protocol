'use strict';

/**
 * INTEGRATION TEST — requires DATABASE_URL
 *
 * These tests are skipped unless DATABASE_URL is set to a real PostgreSQL
 * instance. They are not faked when a database is unavailable.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { createPool, query } = require('../src/db');
const { applyMigrations, getMigrationStatus, listMigrationFiles } = require('../src/db/migrate');

const config = loadConfig();
const hasDatabase = Boolean(config.databaseUrl);

const integration = hasDatabase ? test : test.skip;

integration('INTEGRATION: migrations apply once and remain idempotent on second run', async () => {
  const pool = createPool(config);
  try {
    const first = await applyMigrations({ config, pool, logger: { log() {} } });
    assert.ok(Array.isArray(first.newlyApplied));

    const second = await applyMigrations({ config, pool, logger: { log() {} } });
    assert.deepEqual(second.newlyApplied, []);

    const status = await getMigrationStatus({ config, pool });
    assert.deepEqual(status.pending, []);
    assert.deepEqual(status.applied, listMigrationFiles());
  } finally {
    await pool.end();
  }
});

integration('INTEGRATION: schema ownership constraints exist after migrate', async () => {
  const pool = createPool(config);
  try {
    await applyMigrations({ config, pool, logger: { log() {} } });

    const tables = await query(
      pool,
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [['oauth_exchanges', 'profiles', 'schema_migrations', 'sessions', 'user_progress', 'users']]
    );

    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ['oauth_exchanges', 'profiles', 'schema_migrations', 'sessions', 'user_progress', 'users']
    );

    const fks = await query(
      pool,
      `SELECT
         tc.table_name,
         kcu.column_name,
         ccu.table_name AS foreign_table_name,
         rc.delete_rule
       FROM information_schema.table_constraints AS tc
       JOIN information_schema.key_column_usage AS kcu
         ON tc.constraint_name = kcu.constraint_name
       JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
       JOIN information_schema.referential_constraints AS rc
         ON rc.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name = ANY($1::text[])
       ORDER BY tc.table_name`,
      [['sessions', 'profiles', 'user_progress']]
    );

    assert.equal(fks.rows.length, 3);
    for (const row of fks.rows) {
      assert.equal(row.column_name, 'user_id');
      assert.equal(row.foreign_table_name, 'users');
      assert.equal(row.delete_rule, 'CASCADE');
    }
  } finally {
    await pool.end();
  }
});
