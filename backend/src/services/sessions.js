'use strict';

const { query } = require('../db');
const { AppError } = require('../errors');
const {
  generateRefreshToken,
  hashRefreshToken,
  createAccessToken
} = require('./tokens');

function refreshExpiryDate(config, now = new Date()) {
  return new Date(now.getTime() + config.refreshTokenTtlSeconds * 1000);
}

async function createSession(pool, config, { userId, userAgent = null, ipAddress = null }) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken, config.refreshTokenSecret);
  const expiresAt = refreshExpiryDate(config);

  const result = await query(
    pool,
    `INSERT INTO sessions (
       user_id, refresh_token_hash, expires_at, last_used_at, user_agent, ip_address
     ) VALUES ($1, $2, $3, now(), $4, $5)
     RETURNING id, user_id, created_at, expires_at`,
    [userId, refreshTokenHash, expiresAt.toISOString(), userAgent, ipAddress]
  );

  const session = result.rows[0];
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

async function findValidSessionByRefreshToken(pool, config, refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new AppError('Invalid refresh token', { status: 401, code: 'unauthorized' });
  }

  const refreshTokenHash = hashRefreshToken(refreshToken, config.refreshTokenSecret);
  const result = await query(
    pool,
    `SELECT id, user_id, expires_at, revoked_at
     FROM sessions
     WHERE refresh_token_hash = $1
     LIMIT 1`,
    [refreshTokenHash]
  );

  const session = result.rows[0];
  if (!session) {
    throw new AppError('Invalid refresh token', { status: 401, code: 'unauthorized' });
  }

  if (session.revoked_at) {
    throw new AppError('Session revoked', { status: 401, code: 'session_revoked' });
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new AppError('Session expired', { status: 401, code: 'session_expired' });
  }

  return session;
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

/**
 * Refresh-token rotation:
 * validate current refresh token → revoke that session → issue a new session/token pair.
 */
async function rotateRefreshSession(pool, config, refreshToken, meta = {}) {
  const current = await findValidSessionByRefreshToken(pool, config, refreshToken);
  await revokeSession(pool, current.id);
  return createSession(pool, config, {
    userId: current.user_id,
    userAgent: meta.userAgent || null,
    ipAddress: meta.ipAddress || null
  });
}

module.exports = {
  createSession,
  findValidSessionByRefreshToken,
  revokeSession,
  rotateRefreshSession,
  refreshExpiryDate
};
