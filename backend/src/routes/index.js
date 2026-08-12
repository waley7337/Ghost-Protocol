'use strict';

const { sendJson } = require('../middleware/response');
const { applyCorsHeaders, handlePreflight } = require('../middleware/cors');
const { createPool, checkConnection, getPool, closePool } = require('../db');
const { createRequireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { createAuthHandlers } = require('./auth');
const { createMeHandlers } = require('./me');
const { requireAuthSecrets, ConfigError } = require('../config');

/**
 * Phase 4–7 routes:
 * - health + auth
 * - GET/PUT /me/profile
 * - GET/PUT /me/progress
 * - CORS preflight for browser clients (FRONTEND_URL allowlist)
 */

function createRequestListener(config, dependencies = {}) {
  let authReady = false;
  try {
    requireAuthSecrets(config);
    authReady = true;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    authReady = false;
  }

  const checkDb =
    dependencies.checkDb ||
    (async () => {
      if (!config.databaseUrl) return false;
      const pool = createPool(config);
      try {
        return await checkConnection(pool);
      } finally {
        await pool.end();
      }
    });

  const poolFactory =
    dependencies.getPool ||
    (() => {
      if (!config.databaseUrl) {
        throw new ConfigError('DATABASE_URL is required for authenticated endpoints');
      }
      return getPool(config);
    });

  const requireAuth = dependencies.requireAuth || createRequireAuth(config);
  const rateLimitAuth =
    dependencies.rateLimitAuth ||
    createRateLimiter({
      windowMs: config.authRateLimitWindowMs,
      max: config.authRateLimitMax,
      trustProxy: config.trustProxy,
      keyPrefix: 'auth'
    });

  const auth = createAuthHandlers({
    config,
    getPool: poolFactory,
    requireAuth,
    rateLimitAuth
  });

  const me = createMeHandlers({
    config,
    getPool: poolFactory,
    requireAuth
  });

  return async function requestListener(req, res) {
    try {
      applyCorsHeaders(req, res, config);
      if (handlePreflight(req, res, config)) return;

      const path = req.url ? req.url.split('?')[0] : '';

      if (req.method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'ghost-protocol-api',
          phase: 4,
          environment: config.nodeEnv,
          authConfigured: authReady
        });
        return;
      }

      if (req.method === 'GET' && path === '/health/db') {
        const ok = await checkDb();
        sendJson(res, ok ? 200 : 503, {
          status: ok ? 'ok' : 'unavailable'
        });
        return;
      }

      if (!authReady && (path.startsWith('/auth/') || path.startsWith('/me/'))) {
        sendJson(res, 503, {
          error: 'auth_not_configured',
          message: 'Authentication secrets are not configured'
        });
        return;
      }

      if (req.method === 'POST' && path === '/auth/register') {
        await auth.register(req, res);
        return;
      }
      if (req.method === 'POST' && path === '/auth/login') {
        await auth.login(req, res);
        return;
      }
      if (req.method === 'POST' && path === '/auth/refresh') {
        await auth.refresh(req, res);
        return;
      }
      if (req.method === 'POST' && path === '/auth/logout') {
        await auth.logout(req, res);
        return;
      }
      if (req.method === 'GET' && path === '/auth/me') {
        await auth.me(req, res);
        return;
      }

      if (req.method === 'GET' && path === '/me/profile') {
        await me.getProfile(req, res);
        return;
      }
      if (req.method === 'PUT' && path === '/me/profile') {
        await me.putProfile(req, res);
        return;
      }
      if (req.method === 'GET' && path === '/me/progress') {
        await me.getProgress(req, res);
        return;
      }
      if (req.method === 'PUT' && path === '/me/progress') {
        await me.putProgress(req, res);
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch {
      sendJson(res, 500, { error: 'internal_error' });
    }
  };
}

module.exports = { createRequestListener, closePool };
