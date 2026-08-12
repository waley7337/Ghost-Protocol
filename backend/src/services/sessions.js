'use strict';

const crypto = require('node:crypto');
const { query, DatabaseError, sanitizeDbError } = require('../db');
const { ConfigError } = require('../config');
const { AppError } = require('../errors');
const {
  generateRefreshToken,
  hashRefreshToken,
  createAccessToken
} = require('./tokens');

function refreshExpiryDate(config, now = new Date()) {
  return new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000);
}

function unauthorizedRefresh() {
  // Generic failure — do not disclose family/session internals or reuse vs unknown.
  return new AppError('Invalid refresh token', { status: 401, code: 'unauthorized' });
}

async function issueSessionBundle(config, session, refreshToken) {
  const accessToken = await createAccessToken(config, {
    userId: session.user_id,
    sessionId: session.id
  });

  return {
    session,
    accessToken,
    refreshToken,
    expiresAt: session.expires_at,
    accessTokenExpiresIn: config.accessTokenTtlSeconds
  };
}

async function createSession(pool, config, { userId, userAgent = null, ipAddress = null }) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken, config.refreshTokenSecret);
  const expiresAt = refreshExpiryDate(config);
  const familyId = crypto.randomUUID();

  const result = await query(
    pool,
    `INSERT INTO sessions (
       user_id,
       family_id,
       refresh_token_hash,
       expires_at,
       last_used_at,
       user_agent,
       ip_address
     ) VALUES ($1, $2, $3, $4, now(), $5, $6)
     RETURNING id, user_id, family_id, created_at, expires_at, parent_session_id, replaced_by_session_id, revoked_at`,
    [userId, familyId, refreshTokenHash, expiresAt.toISOString(), userAgent, ipAddress]
  );

  return issueSessionBundle(config, result.rows[0], refreshToken);
}

async function revokeSession(pool, sessionId) {
  await query(
    pool,
    `UPDATE sessions
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE id = $1`,
    [sessionId]
  );
}

async function revokeFamily(client, familyId) {
  await client.query(
    `UPDATE sessions
     SET revoked_at = COALESCE(revoked_at, now())
     WHERE family_id = $1
       AND revoked_at IS NULL`,
    [familyId]
  );
}

/**
 * Refresh-token rotation with family reuse detection.
 *
 * Uses BEGIN + SELECT ... FOR UPDATE + COMMIT so concurrent refreshes of the
 * same credential cannot both leave an active successor (also enforced by
 * sessions_one_active_per_family).
 *
 * Reuse of a replaced refresh credential commits a family-wide revoke, then
 * fails with a generic unauthorized error (revoke must not roll back).
 */
async function rotateRefreshSession(pool, config, refreshToken, meta = {}) {
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw unauthorizedRefresh();
  }

  const refreshTokenHash = hashRefreshToken(refreshToken, config.refreshTokenSecret);
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by_session_id
       FROM sessions
       WHERE refresh_token_hash = $1
       FOR UPDATE`,
      [refreshTokenHash]
    );

    const current = locked.rows[0];
    if (!current) {
      await client.query('ROLLBACK');
      committed = true;
      throw unauthorizedRefresh();
    }

    // Reuse/replay of an already-rotated refresh credential.
    if (current.replaced_by_session_id) {
      await revokeFamily(client, current.family_id);
      await client.query('COMMIT');
      committed = true;
      throw unauthorizedRefresh();
    }

    // Logout or otherwise revoked without replacement — reject, no family wipe.
    if (current.revoked_at) {
      await client.query('ROLLBACK');
      committed = true;
      throw unauthorizedRefresh();
    }

    if (new Date(current.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1`,
        [current.id]
      );
      await client.query('COMMIT');
      committed = true;
      throw unauthorizedRefresh();
    }

    const nextRefreshToken = generateRefreshToken();
    const nextHash = hashRefreshToken(nextRefreshToken, config.refreshTokenSecret);
    const expiresAt = refreshExpiryDate(config);

    // Revoke current before insert so sessions_one_active_per_family remains valid.
    await client.query(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, now()),
           last_used_at = now()
       WHERE id = $1`,
      [current.id]
    );

    const inserted = await client.query(
      `INSERT INTO sessions (
         user_id,
         family_id,
         parent_session_id,
         refresh_token_hash,
         expires_at,
         last_used_at,
         user_agent,
         ip_address
       ) VALUES ($1, $2, $3, $4, $5, now(), $6, $7)
       RETURNING id, user_id, family_id, created_at, expires_at, parent_session_id, replaced_by_session_id, revoked_at`,
      [
        current.user_id,
        current.family_id,
        current.id,
        nextHash,
        expiresAt.toISOString(),
        meta.userAgent || null,
        meta.ipAddress || null
      ]
    );

    const next = inserted.rows[0];

    await client.query(
      `UPDATE sessions
       SET replaced_by_session_id = $2
       WHERE id = $1`,
      [current.id, next.id]
    );

    await client.query('COMMIT');
    committed = true;
    return issueSessionBundle(config, next, nextRefreshToken);
  } catch (error) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
    }
    if (
      error instanceof AppError ||
      error instanceof ConfigError ||
      error instanceof DatabaseError
    ) {
      throw error;
    }
    throw sanitizeDbError(error);
  } finally {
    client.release();
  }
}

async function findValidSessionByRefreshToken(pool, config, refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw unauthorizedRefresh();
  }

  const refreshTokenHash = hashRefreshToken(refreshToken, config.refreshTokenSecret);
  const result = await query(
    pool,
    `SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by_session_id
     FROM sessions
     WHERE refresh_token_hash = $1
     LIMIT 1`,
    [refreshTokenHash]
  );

  const session = result.rows[0];
  if (!session || session.revoked_at || session.replaced_by_session_id) {
    throw unauthorizedRefresh();
  }
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw unauthorizedRefresh();
  }
  return session;
}

module.exports = {
  createSession,
  findValidSessionByRefreshToken,
  revokeSession,
  revokeFamily,
  rotateRefreshSession,
  refreshExpiryDate,
  unauthorizedRefresh
};
