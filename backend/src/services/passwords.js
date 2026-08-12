'use strict';

const argon2 = require('argon2');
const { AppError } = require('../errors');

/**
 * Argon2id password hashing.
 * Never log passwords or password hashes.
 */

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1
});

let dummyHashPromise;

function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('ghost-protocol-timing-dummy', ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError('Password must be between 8 and 128 characters', {
      status: 400,
      code: 'invalid_password'
    });
  }

  return argon2.hash(password, ARGON2_OPTIONS);
}

async function verifyPassword(passwordHash, password) {
  if (typeof password !== 'string' || !passwordHash) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Constant-ish work when a user row is missing (timing mitigation). */
async function verifyPasswordDummy(password) {
  const dummyHash = await getDummyHash();
  try {
    await argon2.verify(dummyHash, typeof password === 'string' ? password : '');
  } catch {
    // Ignore verification failures; the work is the point.
  }
  return false;
}

module.exports = {
  ARGON2_OPTIONS,
  hashPassword,
  verifyPassword,
  verifyPasswordDummy
};
