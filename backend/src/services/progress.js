'use strict';

const { query } = require('../db');
const { AppError } = require('../errors');
const { validateProgressPayload } = require('./progressValidation');

/**
 * Progress is keyed only by authenticated userId.
 * Client-supplied ownership identifiers are ignored / never queried.
 */

async function getProgress(pool, userId) {
  const result = await query(
    pool,
    `SELECT progress, created_at, updated_at
     FROM user_progress
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (!result.rows[0]) {
    throw new AppError('No progress saved yet', {
      status: 404,
      code: 'progress_not_found'
    });
  }

  return {
    progress: result.rows[0].progress,
    createdAt: result.rows[0].created_at,
    updatedAt: result.rows[0].updated_at
  };
}

async function putProgress(pool, userId, body) {
  const progress = validateProgressPayload(body);

  const result = await query(
    pool,
    `INSERT INTO user_progress (user_id, progress, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE
       SET progress = EXCLUDED.progress,
           updated_at = now()
     RETURNING progress, created_at, updated_at`,
    [userId, JSON.stringify(progress)]
  );

  return {
    progress: result.rows[0].progress,
    createdAt: result.rows[0].created_at,
    updatedAt: result.rows[0].updated_at
  };
}

module.exports = {
  getProgress,
  putProgress
};
