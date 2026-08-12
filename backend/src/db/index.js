'use strict';

const { Pool } = require('pg');
const { ConfigError, requireDatabaseUrl } = require('../config');

/**
 * PostgreSQL access layer.
 * Clients (browser/Electron) must never import this module or receive DATABASE_URL.
 */

class DatabaseError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code || 'DATABASE_ERROR';
  }
}

let sharedPool = null;

function shouldUseSsl(config) {
  const mode = (config.databaseSsl || '').toLowerCase();
  if (mode === 'disable' || mode === 'false') return false;
  if (mode === 'require' || mode === 'true') return true;
  return config.nodeEnv === 'production';
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
    poolConfig.ssl = {
      rejectUnauthorized: config.databaseSslRejectUnauthorized !== false
    };
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
  createPool,
  getPool,
  resetPoolForTests,
  closePool,
  sanitizeDbError,
  query,
  withClient,
  checkConnection,
  shouldUseSsl
};
