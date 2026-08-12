'use strict';

/**
 * Server-side configuration.
 * Secrets (DATABASE_URL, token secrets) are never logged and must never ship to clients.
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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const databaseUrl = env.DATABASE_URL ? String(env.DATABASE_URL).trim() : null;

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: parsePort(env.PORT, { required: isProduction }),
    host: env.HOST || '0.0.0.0',
    databaseUrl: databaseUrl || null,
    frontendUrl: env.FRONTEND_URL || null,
    apiPublicUrl: env.API_PUBLIC_URL || null,
    databaseSsl: env.DATABASE_SSL || null,
    databaseSslCaPath: env.DATABASE_SSL_CA || null,
    databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
    accessTokenSecret: env.ACCESS_TOKEN_SECRET || null,
    refreshTokenSecret: env.REFRESH_TOKEN_SECRET || null,
    jwtIssuer: env.JWT_ISSUER || 'ghost-protocol-api',
    jwtAudience: env.JWT_AUDIENCE || 'ghost-protocol-clients',
    accessTokenTtlSeconds: parsePositiveInt(env.ACCESS_TOKEN_TTL_SECONDS, 15 * 60),
    refreshTokenTtlSeconds: parsePositiveInt(env.REFRESH_TOKEN_TTL_SECONDS, 60 * 60 * 24 * 30),
    authRateLimitWindowMs: parsePositiveInt(env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authRateLimitMax: parsePositiveInt(env.AUTH_RATE_LIMIT_MAX, 20),
    trustProxy: env.TRUST_PROXY === 'true',
    jsonBodyLimitBytes: parsePositiveInt(env.JSON_BODY_LIMIT_BYTES, 16 * 1024)
  });
}

function requireDatabaseUrl(config) {
  if (!config.databaseUrl) {
    throw new ConfigError('DATABASE_URL is required for database operations');
  }
  return config.databaseUrl;
}

function requireAuthSecrets(config) {
  if (!config.accessTokenSecret || config.accessTokenSecret.length < 32) {
    throw new ConfigError('ACCESS_TOKEN_SECRET must be set to a value at least 32 characters');
  }
  if (!config.refreshTokenSecret || config.refreshTokenSecret.length < 32) {
    throw new ConfigError('REFRESH_TOKEN_SECRET must be set to a value at least 32 characters');
  }
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

  requireAuthSecrets(config);

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
  requireAuthSecrets,
  assertProductionConfig,
  parsePort
};
