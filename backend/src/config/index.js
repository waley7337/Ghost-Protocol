'use strict';

/**
 * Server-side configuration.
 * DATABASE_URL is never logged and must never be shipped to clients.
 */

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function parsePort(value) {
  const port = Number.parseInt(value || '3000', 10);
  return Number.isFinite(port) && port > 0 ? port : 3000;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const databaseUrl = env.DATABASE_URL || null;

  return Object.freeze({
    nodeEnv,
    port: parsePort(env.PORT),
    databaseUrl,
    frontendUrl: env.FRONTEND_URL || null,
    apiPublicUrl: env.API_PUBLIC_URL || null,
    databaseSsl: env.DATABASE_SSL || null,
    databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
  });
}

function requireDatabaseUrl(config) {
  if (!config.databaseUrl || typeof config.databaseUrl !== 'string' || !config.databaseUrl.trim()) {
    throw new ConfigError('DATABASE_URL is required for database operations');
  }
  return config.databaseUrl.trim();
}

module.exports = {
  ConfigError,
  loadConfig,
  requireDatabaseUrl
};
