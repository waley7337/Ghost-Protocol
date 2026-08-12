'use strict';

const { sendJson } = require('../middleware/response');
const { readJsonBody, sendAppError } = require('../middleware/request');
const { AppError } = require('../errors');
const { getProfile, updateProfile } = require('../services/profiles');
const { getProgress, putProgress } = require('../services/progress');

function handleBodyError(res, error) {
  if (error.code === 'payload_too_large') {
    sendAppError(
      res,
      new AppError('Request body too large', { status: 413, code: 'payload_too_large' })
    );
    return true;
  }
  if (error.code === 'invalid_json') {
    sendAppError(res, new AppError('Invalid JSON body', { status: 400, code: 'invalid_json' }));
    return true;
  }
  return false;
}

/**
 * /me/* handlers.
 * Ownership ALWAYS comes from req.auth.userId after requireAuth.
 * Client body/query/header user_id values are never used for authorization.
 */
function createMeHandlers({ config, getPool, requireAuth }) {
  const progressLimit =
    config.progressBodyLimitBytes || Math.max(config.jsonBodyLimitBytes || 16_384, 65_536);

  return {
    async getProfile(req, res) {
      if (!(await requireAuth(req, res))) return;
      try {
        const profile = await getProfile(getPool(), req.auth.userId);
        sendJson(res, 200, { profile });
      } catch (error) {
        sendAppError(res, error);
      }
    },

    async putProfile(req, res) {
      if (!(await requireAuth(req, res))) return;
      try {
        const body = await readJsonBody(req, { limitBytes: config.jsonBodyLimitBytes });
        // Explicitly ignore any client-supplied ownership fields.
        delete body.user_id;
        delete body.userId;
        delete body.id;
        const profile = await updateProfile(getPool(), req.auth.userId, body);
        sendJson(res, 200, { profile });
      } catch (error) {
        if (handleBodyError(res, error)) return;
        sendAppError(res, error);
      }
    },

    async getProgress(req, res) {
      if (!(await requireAuth(req, res))) return;
      try {
        const result = await getProgress(getPool(), req.auth.userId);
        sendJson(res, 200, result);
      } catch (error) {
        sendAppError(res, error);
      }
    },

    async putProgress(req, res) {
      if (!(await requireAuth(req, res))) return;
      try {
        const body = await readJsonBody(req, { limitBytes: progressLimit });
        delete body.user_id;
        delete body.userId;
        delete body.id;
        const result = await putProgress(getPool(), req.auth.userId, body);
        sendJson(res, 200, result);
      } catch (error) {
        if (handleBodyError(res, error)) return;
        sendAppError(res, error);
      }
    }
  };
}

module.exports = { createMeHandlers };
