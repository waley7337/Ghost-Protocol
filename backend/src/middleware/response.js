'use strict';

/**
 * Shared response helpers.
 * Prefer setHeader so prior CORS headers are preserved.
 */

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(statusCode);
  res.end(payload);
}

module.exports = { sendJson };
