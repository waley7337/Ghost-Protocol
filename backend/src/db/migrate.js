'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createPool, withClient, closePool, resetPoolForTests } = require('./index');
const { loadConfig, requireDatabaseUrl, ConfigError } = require('../config');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

const MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

function listMigrationFiles(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{3}_.+\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function readMigration(migrationsDir, fileName) {
  const fullPath = path.join(migrationsDir, fileName);
  return fs.readFileSync(fullPath, 'utf8');
}

async function ensureMigrationsTable(client) {
  await client.query(MIGRATIONS_TABLE_SQL);
}

async function getAppliedMigrationIds(client) {
  const result = await client.query(
    'SELECT id FROM schema_migrations ORDER BY id ASC'
  );
  return result.rows.map((row) => row.id);
}

async function getMigrationStatus({
  config = loadConfig(),
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  pool = null
} = {}) {
  requireDatabaseUrl(config);
  const ownsPool = !pool;
  const activePool = pool || createPool(config);

  try {
    return await withClient(activePool, async (client) => {
      await ensureMigrationsTable(client);
      const applied = await getAppliedMigrationIds(client);
      const files = listMigrationFiles(migrationsDir);
      const appliedSet = new Set(applied);
      const pending = files.filter((file) => !appliedSet.has(file));
      return { applied, pending, files };
    });
  } finally {
    if (ownsPool) {
      await activePool.end();
    }
  }
}

async function applyMigrations({
  config = loadConfig(),
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  pool = null,
  logger = console
} = {}) {
  requireDatabaseUrl(config);
  const ownsPool = !pool;
  const activePool = pool || createPool(config);

  try {
    const result = await withClient(activePool, async (client) => {
      await client.query('BEGIN');
      try {
        await ensureMigrationsTable(client);
        const applied = await getAppliedMigrationIds(client);
        const appliedSet = new Set(applied);
        const files = listMigrationFiles(migrationsDir);
        const pending = files.filter((file) => !appliedSet.has(file));
        const newlyApplied = [];

        for (const fileName of pending) {
          const sql = readMigration(migrationsDir, fileName);
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (id) VALUES ($1)',
            [fileName]
          );
          newlyApplied.push(fileName);
          if (logger && typeof logger.info === 'function') {
            logger.info(`Applied migration ${fileName}`);
          } else if (logger && typeof logger.log === 'function') {
            logger.log(`Applied migration ${fileName}`);
          }
        }

        await client.query('COMMIT');
        return {
          applied: [...applied, ...newlyApplied],
          newlyApplied,
          pendingAfter: []
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return result;
  } finally {
    if (ownsPool) {
      await activePool.end();
    }
  }
}

async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] || 'up';
  const config = loadConfig();

  try {
    if (command === 'status') {
      const status = await getMigrationStatus({ config });
      process.stdout.write(
        `${JSON.stringify({ applied: status.applied, pending: status.pending }, null, 2)}\n`
      );
      return;
    }

    if (command === 'up') {
      const result = await applyMigrations({ config });
      process.stdout.write(
        `${JSON.stringify({ newlyApplied: result.newlyApplied, applied: result.applied }, null, 2)}\n`
      );
      return;
    }

    throw new ConfigError(`Unknown migration command: ${command}`);
  } finally {
    resetPoolForTests();
    await closePool();
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    const message =
      error instanceof ConfigError || error?.name === 'DatabaseError'
        ? error.message
        : 'Migration failed';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  MIGRATIONS_TABLE_SQL,
  listMigrationFiles,
  readMigration,
  getMigrationStatus,
  applyMigrations,
  runCli
};
