'use strict';

/**
 * Route table for Phase 1.
 * Only a health check is registered. Auth/profile/progress routes come later.
 */

const { sendJson } = require('../middleware/response');

function createRequestListener(config) {
  return function requestListener(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'ghost-protocol-api',
        phase: 1,
        environment: config.nodeEnv
      });
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  };
}

module.exports = { createRequestListener };
