'use strict';

const { query } = require('../db');
const { AppError } = require('../errors');

const NAME_MAX = 80;
const AVATAR_URL_MAX = 2048;

function publicProfile(row) {
  return {
    name: row.name,
    avatarUrl: row.avatar_url || null,
    updatedAt: row.updated_at,
    createdAt: row.created_at
  };
}

function validateProfileUpdate(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Invalid profile body', { status: 400, code: 'invalid_body' });
  }

  const allowed = new Set(['name', 'avatarUrl']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new AppError(`Unsupported profile field: ${key}`, {
        status: 400,
        code: 'unsupported_field'
      });
    }
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'name') &&
      !Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
    throw new AppError('No updatable profile fields provided', {
      status: 400,
      code: 'invalid_body'
    });
  }

  const result = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    if (typeof body.name !== 'string') {
      throw new AppError('name must be a string', { status: 400, code: 'invalid_name' });
    }
    const name = body.name.trim();
    if (!name || name.length > NAME_MAX) {
      throw new AppError(`name must be 1–${NAME_MAX} characters`, {
        status: 400,
        code: 'invalid_name'
      });
    }
    result.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
    if (body.avatarUrl === null) {
      result.avatarUrl = null;
    } else if (typeof body.avatarUrl !== 'string') {
      throw new AppError('avatarUrl must be a string or null', {
        status: 400,
        code: 'invalid_avatar_url'
      });
    } else {
      const avatarUrl = body.avatarUrl.trim();
      if (!avatarUrl) {
        result.avatarUrl = null;
      } else {
        if (avatarUrl.length > AVATAR_URL_MAX) {
          throw new AppError('avatarUrl is too long', {
            status: 400,
            code: 'invalid_avatar_url'
          });
        }
        if (!/^https:\/\//i.test(avatarUrl) && !avatarUrl.startsWith('/')) {
          throw new AppError('avatarUrl must be an https URL or site-relative path', {
            status: 400,
            code: 'invalid_avatar_url'
          });
        }
        result.avatarUrl = avatarUrl;
      }
    }
  }

  return result;
}

/**
 * Ensure a profile row exists for the authenticated user (lazy create).
 * Ownership is always the provided userId from req.auth — never from the client.
 */
async function ensureProfile(pool, userId, defaultName = 'Operative') {
  const result = await query(
    pool,
    `INSERT INTO profiles (user_id, name, avatar_url)
     VALUES ($1, $2, NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET name = profiles.name
     RETURNING user_id, name, avatar_url, created_at, updated_at`,
    [userId, defaultName]
  );
  return publicProfile(result.rows[0]);
}

async function getProfile(pool, userId) {
  return ensureProfile(pool, userId);
}

async function updateProfile(pool, userId, body) {
  const patch = validateProfileUpdate(body);
  const current = await ensureProfile(pool, userId);
  const nextName = Object.prototype.hasOwnProperty.call(patch, 'name')
    ? patch.name
    : current.name;
  const nextAvatar = Object.prototype.hasOwnProperty.call(patch, 'avatarUrl')
    ? patch.avatarUrl
    : current.avatarUrl;

  const result = await query(
    pool,
    `INSERT INTO profiles (user_id, name, avatar_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = now()
     RETURNING user_id, name, avatar_url, created_at, updated_at`,
    [userId, nextName, nextAvatar]
  );

  return publicProfile(result.rows[0]);
}

module.exports = {
  NAME_MAX,
  AVATAR_URL_MAX,
  publicProfile,
  validateProfileUpdate,
  ensureProfile,
  getProfile,
  updateProfile
};
