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

function parsePort(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ConfigError('PORT is required in production (Railway injects PORT)');
    }
    return 3000;
  }

  const port = Number.parseInt(String(value), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new ConfigError('PORT must be a valid TCP port number');
  }
  return port;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const databaseUrl = env.DATABASE_URL ? String(env.DATABASE_URL).trim() : null;

  return Object.freeze({
    nodeEnv,
    isProduction,
    // Railway/containers inject PORT. Bind host defaults to all interfaces.
    port: parsePort(env.PORT, { required: isProduction }),
    host: env.HOST || (isProduction ? '0.0.0.0' : '0.0.0.0'),
    databaseUrl: databaseUrl || null,
    frontendUrl: env.FRONTEND_URL || null,
    apiPublicUrl: env.API_PUBLIC_URL || null,
    databaseSsl: env.DATABASE_SSL || null,
    databaseSslCaPath: env.DATABASE_SSL_CA || null,
    // Default true: do not weaken certificate validation unless explicitly opted out.
    databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
  });
}

function requireDatabaseUrl(config) {
  if (!config.databaseUrl) {
    throw new ConfigError('DATABASE_URL is required for database operations');
  }
  return config.databaseUrl;
}

/**
 * Production startup gate for Railway (and similar hosts).
 * Does not print or include secret values in the error message.
 */
function assertProductionConfig(config) {
  if (!config.isProduction) return;

  if (!config.databaseUrl) {
    throw new ConfigError(
      'DATABASE_URL is required in production (set via Railway service variables)'
    );
  }

  if (!/^postgres(ql)?:\/\//i.test(config.databaseUrl)) {
    throw new ConfigError('DATABASE_URL must be a postgresql:// or postgres:// URL');
  }

  // Reject obviously client-side naming mistakes if somehow injected.
  if (process.env.VITE_DATABASE_URL || process.env.NEXT_PUBLIC_DATABASE_URL) {
    throw new ConfigError(
      'Client-exposed database variables are forbidden (VITE_DATABASE_URL / NEXT_PUBLIC_DATABASE_URL)'
    );
  }
}

module.exports = {
  ConfigError,
  loadConfig,
  requireDatabaseUrl,
  assertProductionConfig,
  parsePort
};
