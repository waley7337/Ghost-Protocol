'use strict';

/**
 * Browser CORS helpers for Ghost Protocol API (Phase 7).
 * Electron typically has no Origin header for file:// loads.
 * Never reflects arbitrary Origins — allowlist via FRONTEND_URL (+ local defaults).
 */

function parseAllowedOrigins(config) {
  const origins = new Set();
  const raw = config?.frontendUrl;
  if (typeof raw === 'string' && raw.trim()) {
    for (const part of raw.split(',')) {
      const value = part.trim().replace(/\/+$/, '');
      if (value) origins.add(value);
    }
  }

  // Local development conveniences (static web preview / Electron loopback tooling)
  if (!config?.isProduction) {
    origins.add('http://127.0.0.1:4173');
    origins.add('http://localhost:4173');
    origins.add('http://127.0.0.1:3000');
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:5173');
    origins.add('http://localhost:5173');
  }

  return origins;
}

function resolveAllowedOrigin(req, config) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin) return null;
  const allowed = parseAllowedOrigins(config);
  return allowed.has(origin.replace(/\/+$/, '')) ? origin : null;
}

function applyCorsHeaders(req, res, config) {
  const allowedOrigin = resolveAllowedOrigin(req, config);
  if (!allowedOrigin) return false;

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function handlePreflight(req, res, config) {
  if (req.method !== 'OPTIONS') return false;
  applyCorsHeaders(req, res, config);
  res.writeHead(204);
  res.end();
  return true;
}

module.exports = {
  parseAllowedOrigins,
  resolveAllowedOrigin,
  applyCorsHeaders,
  handlePreflight
};
