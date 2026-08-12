'use strict';

const { query, DatabaseError } = require('../db');
const { AppError } = require('../errors');
const {
  hashPassword,
  verifyPassword,
  verifyPasswordDummy
} = require('./passwords');
const { createSession, rotateRefreshSession, revokeSession } = require('./sessions');
const { hashRefreshToken } = require('./tokens');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function validateEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 320 || !EMAIL_RE.test(normalized)) {
    throw new AppError('A valid email address is required', {
      status: 400,
      code: 'invalid_email'
    });
  }
  return normalized;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified,
    createdAt: row.created_at
  };
}

async function registerUser(pool, config, { email, password, userAgent, ipAddress }) {
  const normalizedEmail = validateEmail(email);
  const passwordHash = await hashPassword(password);

  let inserted;
  try {
    inserted = await query(
      pool,
      `INSERT INTO users (email, password_hash, email_verified)
       VALUES ($1, $2, FALSE)
       RETURNING id, email, email_verified, created_at`,
      [normalizedEmail, passwordHash]
    );
  } catch (error) {
    if (
      (error instanceof DatabaseError && error.code === '23505') ||
      error?.code === '23505'
    ) {
      throw new AppError('Unable to create account with that email', {
        status: 409,
        code: 'email_unavailable'
      });
    }
    throw error;
  }

  const user = inserted.rows[0];
  const sessionBundle = await createSession(pool, config, {
    userId: user.id,
    userAgent,
    ipAddress
  });

  return {
    user: publicUser(user),
    ...sessionBundle
  };
}

async function loginUser(pool, config, { email, password, userAgent, ipAddress }) {
  const normalizedEmail = validateEmail(email);
  const result = await query(
    pool,
    `SELECT id, email, password_hash, email_verified, created_at
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [normalizedEmail]
  );

  const user = result.rows[0];
  if (!user || !user.password_hash) {
    await verifyPasswordDummy(password);
    throw new AppError('Invalid email or password', {
      status: 401,
      code: 'invalid_credentials'
    });
  }

  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    throw new AppError('Invalid email or password', {
      status: 401,
      code: 'invalid_credentials'
    });
  }

  const sessionBundle = await createSession(pool, config, {
    userId: user.id,
    userAgent,
    ipAddress
  });

  return {
    user: publicUser(user),
    ...sessionBundle
  };
}

async function refreshAuth(pool, config, { refreshToken, userAgent, ipAddress }) {
  return rotateRefreshSession(pool, config, refreshToken, { userAgent, ipAddress });
}

async function logoutAuth(pool, config, { refreshToken }) {
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new AppError('Invalid refresh token', { status: 401, code: 'unauthorized' });
  }

  const refreshTokenHash = hashRefreshToken(refreshToken, config.refreshTokenSecret);
  const result = await query(
    pool,
    `SELECT id FROM sessions WHERE refresh_token_hash = $1 LIMIT 1`,
    [refreshTokenHash]
  );

  const session = result.rows[0];
  if (!session) {
    throw new AppError('Invalid refresh token', { status: 401, code: 'unauthorized' });
  }

  await revokeSession(pool, session.id);
  return { revoked: true };
}

async function getUserById(pool, userId) {
  const result = await query(
    pool,
    `SELECT id, email, email_verified, created_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  const user = result.rows[0];
  if (!user) {
    throw new AppError('User not found', { status: 401, code: 'unauthorized' });
  }

  return publicUser(user);
}

module.exports = {
  normalizeEmail,
  validateEmail,
  publicUser,
  registerUser,
  loginUser,
  refreshAuth,
  logoutAuth,
  getUserById
};
