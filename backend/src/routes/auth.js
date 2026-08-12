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

function createAuthHandlers({ config, getPool, requireAuth, rateLimitAuth }) {
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
        sendAppError(res, error);
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
        sendAppError(res, error);
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
        sendAppError(res, error);
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
        sendAppError(res, error);
      }
    },

    async me(req, res) {
      if (!(await requireAuth(req, res))) return;
      try {
        const pool = getPool();
        const user = await getUserById(pool, req.auth.userId);
        sendJson(res, 200, { user });
      } catch (error) {
        sendAppError(res, error);
      }
    }
  };
}

module.exports = { createAuthHandlers, tokenResponse };
