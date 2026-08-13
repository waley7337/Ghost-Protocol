'use strict';

const { sendJson } = require('./response');
const { toClientError, logUnexpectedError } = require('../errors');

const MAX_BODY_BYTES_DEFAULT = 16 * 1024;

async function readJsonBody(req, { limitBytes = MAX_BODY_BYTES_DEFAULT } = {}) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      const error = new Error('payload_too_large');
      error.code = 'payload_too_large';
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const error = new Error('invalid_json');
      error.code = 'invalid_json';
      throw error;
    }
    return parsed;
  } catch (error) {
    if (error.code === 'invalid_json' || error.code === 'payload_too_large') throw error;
    const invalid = new Error('invalid_json');
    invalid.code = 'invalid_json';
    throw invalid;
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function clientIp(req, { trustProxy = false } = {}) {
  // Default: use the direct socket address. Spoofable forwarding headers are ignored
  // unless TRUST_PROXY=true is explicitly enabled behind a trusted edge.
  let ip = null;
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      ip = forwarded.split(',')[0].trim();
    }
  }
  if (!ip) {
    ip = req.socket?.remoteAddress || null;
  }
  // sessions.ip_address is INET — never send a non-IP sentinel like "unknown".
  if (!ip || ip === 'unknown') return null;
  return ip;
}

function sendAppError(res, error, meta = {}) {
  logUnexpectedError(error, meta);
  const mapped = toClientError(error);
  sendJson(res, mapped.status, mapped.body);
}

module.exports = {
  readJsonBody,
  getBearerToken,
  clientIp,
  sendAppError,
  MAX_BODY_BYTES_DEFAULT
};
