'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');
const { ConfigError, requireDatabaseUrl } = require('../config');

/**
 * PostgreSQL access layer.
 * Clients (browser/Electron) must never import this module or receive DATABASE_URL.
 *
 * Railway note:
 * - Prefer Railway's private DATABASE_URL between backend and Postgres services.
 * - TLS behavior is controlled explicitly (see shouldUseSsl / buildSslConfig).
 * - Certificate validation stays enabled unless DATABASE_SSL_REJECT_UNAUTHORIZED=false
 *   is set deliberately after documenting residual risk.
 */

class DatabaseError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code || 'DATABASE_ERROR';
  }
}

let sharedPool = null;

function readSslModeFromUrl(connectionString) {
  try {
    const url = new URL(connectionString);
    return (url.searchParams.get('sslmode') || '').toLowerCase();
  } catch {
    return '';
  }
}

function shouldUseSsl(config) {
  const mode = (config.databaseSsl || '').toLowerCase();
  if (mode === 'disable' || mode === 'false') return false;
  if (mode === 'require' || mode === 'true') return true;

  const urlMode = config.databaseUrl ? readSslModeFromUrl(config.databaseUrl) : '';
  if (urlMode === 'disable') return false;
  if (urlMode === 'require' || urlMode === 'verify-ca' || urlMode === 'verify-full') {
    return true;
  }

  // Production default: use TLS (Railway Postgres expects encrypted connections).
  // Development default without explicit config: no TLS (typical local Postgres).
  return config.nodeEnv === 'production';
}

function buildSslConfig(config) {
  const ssl = {
    rejectUnauthorized: config.databaseSslRejectUnauthorized !== false
  };

  if (config.databaseSslCaPath) {
    try {
      ssl.ca = fs.readFileSync(config.databaseSslCaPath, 'utf8');
    } catch {
      throw new ConfigError(
        'DATABASE_SSL_CA file could not be read (path invalid or inaccessible)'
      );
    }
  }

  return ssl;
}

function buildPoolConfig(config) {
  const connectionString = requireDatabaseUrl(config);
  const poolConfig = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
  };

  if (shouldUseSsl(config)) {
    poolConfig.ssl = buildSslConfig(config);
  }

  return poolConfig;
}

function createPool(config) {
  return new Pool(buildPoolConfig(config));
}

function getPool(config) {
  if (!sharedPool) {
    sharedPool = createPool(config);
  }
  return sharedPool;
}

function resetPoolForTests() {
  const previous = sharedPool;
  sharedPool = null;
  return previous;
}

async function closePool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

/**
 * Strip credentials/connection details from driver errors before they leave the DB layer.
 */
function sanitizeDbError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'DATABASE_ERROR';
  return new DatabaseError('A database error occurred', { code });
}

async function query(pool, text, params = []) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new DatabaseError('Query text is required', { code: 'INVALID_QUERY' });
  }
  if (!Array.isArray(params)) {
    throw new DatabaseError('Query parameters must be an array', { code: 'INVALID_PARAMS' });
  }

  try {
    return await pool.query(text, params);
  } catch (error) {
    if (error instanceof ConfigError || error instanceof DatabaseError) {
      throw error;
    }
    throw sanitizeDbError(error);
  }
}

async function withClient(pool, fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function withTransaction(pool, fn) {
  return withClient(pool, async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback failures; original error matters.
      }
      if (error instanceof ConfigError || error instanceof DatabaseError || error?.name === 'AppError') {
        throw error;
      }
      throw sanitizeDbError(error);
    }
  });
}

async function checkConnection(pool) {
  try {
    await query(pool, 'SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  DatabaseError,
  buildPoolConfig,
  buildSslConfig,
  createPool,
  getPool,
  resetPoolForTests,
  closePool,
  sanitizeDbError,
  query,
  withClient,
  withTransaction,
  checkConnection,
  shouldUseSsl,
  readSslModeFromUrl
};
