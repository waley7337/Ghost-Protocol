'use strict';

const { sendJson } = require('./response');

/**
 * Simple in-process sliding-window rate limiter for auth endpoints.
 * Suitable as an application foundation. Edge/Cloudflare limits remain for deployment phase.
 * Does not invent a distributed store yet.
 */

function createRateLimiter({
  windowMs,
  max,
  trustProxy = false,
  keyPrefix = 'auth'
} = {}) {
  const hits = new Map();

  function keyFor(req, clientIpFn) {
    return `${keyPrefix}:${clientIpFn(req, { trustProxy })}`;
  }

  function prune(now) {
    for (const [key, entry] of hits.entries()) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function rateLimit(req, res, clientIpFn) {
    const now = Date.now();
    prune(now);
    const key = keyFor(req, clientIpFn);
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    current.count += 1;
    if (current.count > max) {
      sendJson(res, 429, {
        error: 'rate_limited',
        message: 'Too many authentication attempts. Try again later.'
      });
      return false;
    }

    return true;
  };
}

module.exports = { createRateLimiter };
