'use strict';

const { sendJson } = require('../middleware/response');
const { createPool, checkConnection, closePool } = require('../db');

/**
 * Phase 2 routes:
 * - GET /health
 * - GET /health/db (connectivity only; no infrastructure details)
 *
 * Auth/profile/progress endpoints are intentionally absent until later phases.
 */

function createRequestListener(config, dependencies = {}) {
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

  return async function requestListener(req, res) {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'ghost-protocol-api',
          phase: 2,
          environment: config.nodeEnv
        });
        return;
      }

      if (req.method === 'GET' && req.url === '/health/db') {
        const ok = await checkDb();
        sendJson(res, ok ? 200 : 503, {
          status: ok ? 'ok' : 'unavailable'
        });
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch {
      sendJson(res, 500, { error: 'internal_error' });
    }
  };
}

module.exports = { createRequestListener, closePool };
