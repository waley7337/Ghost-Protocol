'use strict';

const { verifyAccessToken } = require('../services/tokens');
const { AppError } = require('../errors');
const { getBearerToken, sendAppError } = require('./request');

/**
 * Central authn middleware: derive identity only from validated access tokens.
 * Never trusts client-supplied user_id / role / email for authorization.
 */

function createRequireAuth(config) {
  return async function requireAuth(req, res) {
    try {
      const token = getBearerToken(req);
      const auth = await verifyAccessToken(config, token);
      req.auth = {
        userId: auth.userId,
        sessionId: auth.sessionId
      };
      return true;
    } catch (error) {
      sendAppError(
        res,
        error instanceof AppError
          ? error
          : new AppError('Authentication required', { status: 401, code: 'unauthorized' })
      );
      return false;
    }
  };
}

module.exports = { createRequireAuth };
