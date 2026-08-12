'use strict';

const crypto = require('node:crypto');
const { SignJWT, jwtVerify, errors: joseErrors } = require('jose');
const { AppError } = require('../errors');

/**
 * Access tokens (JWT) and refresh-token material.
 * Signing secrets stay server-side. Refresh tokens are never stored plaintext.
 */

function secretKey(secret) {
  return new TextEncoder().encode(secret);
}

function hashRefreshToken(refreshToken, refreshTokenSecret) {
  return crypto
    .createHmac('sha256', refreshTokenSecret)
    .update(refreshToken, 'utf8')
    .digest('hex');
}

function generateRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

async function createAccessToken(config, { userId, sessionId }) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sid: sessionId,
    typ: 'access'
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt(now)
    .setExpirationTime(now + config.accessTokenTtlSeconds)
    .sign(secretKey(config.accessTokenSecret));
}

async function verifyAccessToken(config, token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new AppError('Authentication required', { status: 401, code: 'unauthorized' });
  }

  try {
    const { payload } = await jwtVerify(token, secretKey(config.accessTokenSecret), {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      algorithms: ['HS256']
    });

    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || !payload.sub) {
      throw new AppError('Invalid access token', { status: 401, code: 'unauthorized' });
    }

    return {
      userId: payload.sub,
      sessionId: typeof payload.sid === 'string' ? payload.sid : null,
      payload
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    if (error instanceof joseErrors.JWTExpired) {
      throw new AppError('Access token expired', { status: 401, code: 'token_expired' });
    }

    throw new AppError('Invalid access token', { status: 401, code: 'unauthorized' });
  }
}

module.exports = {
  hashRefreshToken,
  generateRefreshToken,
  createAccessToken,
  verifyAccessToken
};
