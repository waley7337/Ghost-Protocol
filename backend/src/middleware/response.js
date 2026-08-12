'use strict';

/**
 * Shared response helpers.
 * Centralized error handling and security headers will expand here later.
 */

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

module.exports = { sendJson };
