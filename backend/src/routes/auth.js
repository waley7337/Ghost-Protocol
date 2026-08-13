'use strict';

const { sendJson } = require('../middleware/response');
const {
  readJsonBody,
  clientIp,
  sendAppError
} = require('../middleware/request');
const { AppError } = require('../errors');
const {
  registerUser,
  loginUser,
  refreshAuth,
  logoutAuth,
  getUserById
} = require('../services/users');
const {
  startGoogleOAuth,
  completeGoogleOAuth,
  consumeExchangeCode
} = require('../services/googleOAuth');

function tokenResponse(bundle) {
  const body = {
    accessToken: bundle.accessToken,
    refreshToken: bundle.refreshToken,
    tokenType: 'Bearer',
    expiresIn: bundle.accessTokenExpiresIn,
    session: {
      id: bundle.session.id,
      expiresAt: bundle.session.expires_at
    }
  };
  if (bundle.user) body.user = bundle.user;
  return body;
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  res.end();
}

function parseQuery(req) {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function createAuthHandlers({ config, getPool, requireAuth, rateLimitAuth, fetchImpl }) {
  return {
    async register(req, res) {
      if (rateLimitAuth && !rateLimitAuth(req, res, clientIp)) return;
      try {
        const body = await readJsonBody(req, { limitBytes: config.jsonBodyLimitBytes });
        const pool = getPool();
        const result = await registerUser(pool, config, {
          email: body.email,
          password: body.password,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          ipAddress: clientIp(req, { trustProxy: config.trustProxy })
        });
        sendJson(res, 201, tokenResponse(result));
      } catch (error) {
        if (error.code === 'payload_too_large') {
          sendAppError(res, new AppError('Request body too large', { status: 413, code: 'payload_too_large' }));
          return;
        }
        if (error.code === 'invalid_json') {
          sendAppError(res, new AppError('Invalid JSON body', { status: 400, code: 'invalid_json' }));
          return;
        }
        sendAppError(res, error, { route: '/auth/register', method: 'POST' });
      }
    },

    async login(req, res) {
      if (rateLimitAuth && !rateLimitAuth(req, res, clientIp)) return;
      try {
        const body = await readJsonBody(req, { limitBytes: config.jsonBodyLimitBytes });
        const pool = getPool();
        const result = await loginUser(pool, config, {
          email: body.email,
          password: body.password,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          ipAddress: clientIp(req, { trustProxy: config.trustProxy })
        });
        sendJson(res, 200, tokenResponse(result));
      } catch (error) {
        if (error.code === 'payload_too_large') {
          sendAppError(res, new AppError('Request body too large', { status: 413, code: 'payload_too_large' }));
          return;
        }
        if (error.code === 'invalid_json') {
          sendAppError(res, new AppError('Invalid JSON body', { status: 400, code: 'invalid_json' }));
          return;
        }
        sendAppError(res, error, { route: '/auth/login', method: 'POST' });
      }
    },

    async refresh(req, res) {
      if (rateLimitAuth && !rateLimitAuth(req, res, clientIp)) return;
      try {
        const body = await readJsonBody(req, { limitBytes: config.jsonBodyLimitBytes });
        const pool = getPool();
        const result = await refreshAuth(pool, config, {
          refreshToken: body.refreshToken,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          ipAddress: clientIp(req, { trustProxy: config.trustProxy })
        });
        sendJson(res, 200, tokenResponse(result));
      } catch (error) {
        if (error.code === 'payload_too_large') {
          sendAppError(res, new AppError('Request body too large', { status: 413, code: 'payload_too_large' }));
          return;
        }
        if (error.code === 'invalid_json') {
          sendAppError(res, new AppError('Invalid JSON body', { status: 400, code: 'invalid_json' }));
          return;
        }
        sendAppError(res, error, { route: '/auth/refresh', method: 'POST' });
      }
    },

    async logout(req, res) {
      try {
        const body = await readJsonBody(req, { limitBytes: config.jsonBodyLimitBytes });
        const pool = getPool();
        await logoutAuth(pool, config, { refreshToken: body.refreshToken });
        sendJson(res, 200, { status: 'ok' });
      } catch (error) {
        if (error.code === 'payload_too_large') {
          sendAppError(res, new AppError('Request body too large', { status: 413, code: 'payload_too_large' }));
          return;
        }
        if (error.code === 'invalid_json') {
          sendAppError(res, new AppError('Invalid JSON body', { status: 400, code: 'invalid_json' }));
          return;
        }
        sendAppError(res, error, { route: '/auth/logout', method: 'POST' });
      }
    },

    async me(req, res) {
      if (!(await requireAuth(req, res))) return;
      try {
        const pool = getPool();
        const user = await getUserById(pool, req.auth.userId);
        sendJson(res, 200, { user });
      } catch (error) {
        sendAppError(res, error, { route: '/auth/me', method: 'GET' });
      }
    },

    async googleStart(req, res) {
      if (rateLimitAuth && !rateLimitAuth(req, res, clientIp)) return;
      try {
        const params = parseQuery(req);
        const started = await startGoogleOAuth(config, {
          returnTo: params.get('return_to') || undefined,
          platform: params.get('platform') || undefined
        });
        sendRedirect(res, started.url);
      } catch (error) {
        sendAppError(res, error, { route: '/auth/google', method: 'GET' });
      }
    },

    async googleCallback(req, res) {
      if (rateLimitAuth && !rateLimitAuth(req, res, clientIp)) return;
      try {
        const params = parseQuery(req);
        const pool = getPool();
        const result = await completeGoogleOAuth(pool, config, {
          code: params.get('code') || undefined,
          state: params.get('state') || undefined,
          error: params.get('error') || undefined,
          errorDescription: params.get('error_description') || undefined,
          fetchImpl,
          userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
          ipAddress: clientIp(req, { trustProxy: config.trustProxy })
        });
        sendRedirect(res, result.redirectTo);
      } catch (error) {
        sendAppError(res, error, { route: '/auth/google/callback', method: 'GET' });
      }
    },

    async googleExchange(req, res) {
      if (rateLimitAuth && !rateLimitAuth(req, res, clientIp)) return;
      try {
        const body = await readJsonBody(req, { limitBytes: config.jsonBodyLimitBytes });
        const pool = getPool();
        const bundle = await consumeExchangeCode(pool, body.exchangeCode || body.code);
        sendJson(res, 200, bundle);
      } catch (error) {
        if (error.code === 'payload_too_large') {
          sendAppError(res, new AppError('Request body too large', { status: 413, code: 'payload_too_large' }));
          return;
        }
        if (error.code === 'invalid_json') {
          sendAppError(res, new AppError('Invalid JSON body', { status: 400, code: 'invalid_json' }));
          return;
        }
        sendAppError(res, error, { route: '/auth/google/exchange', method: 'POST' });
      }
    }
  };
}

module.exports = { createAuthHandlers, tokenResponse, sendRedirect };
