'use strict';

const { AppError } = require('../errors');

const PROGRESS_KEYS = Object.freeze([
  'xp',
  'solved',
  'streak',
  'lastDay',
  'bestTimes',
  'notes',
  'quizScores',
  'achievements',
  'unlocks',
  'preferences',
  'settings'
]);

const LIMITS = Object.freeze({
  maxXp: 1_000_000,
  maxStreak: 100_000,
  maxSolved: 500,
  maxSolvedIdLength: 128,
  maxLastDayLength: 64,
  maxObjectKeys: 200,
  maxStringValueLength: 4_000,
  maxNotesEntries: 100,
  maxAchievements: 200,
  maxUnlocks: 200,
  maxNestedDepth: 3
});

function assertPlainObject(value, code, message) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(message, { status: 400, code });
  }
}

function assertFiniteNumber(value, code, message) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(message, { status: 400, code });
  }
}

function countDepth(value, depth = 0) {
  if (depth > LIMITS.maxNestedDepth) return depth;
  if (value && typeof value === 'object') {
    let max = depth;
    const entries = Array.isArray(value) ? value : Object.values(value);
    for (const entry of entries) {
      max = Math.max(max, countDepth(entry, depth + 1));
    }
    return max;
  }
  return depth;
}

function validateStringMap(obj, { code, maxEntries, maxKeyLength = 128 }) {
  assertPlainObject(obj, code, 'Expected an object');
  const keys = Object.keys(obj);
  if (keys.length > maxEntries) {
    throw new AppError('Object has too many keys', { status: 400, code });
  }
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0 || key.length > maxKeyLength) {
      throw new AppError('Invalid object key', { status: 400, code });
    }
    const value = obj[key];
    if (typeof value === 'string') {
      if (value.length > LIMITS.maxStringValueLength) {
        throw new AppError('String value too long', { status: 400, code });
      }
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new AppError('Numeric value must be finite', { status: 400, code });
      }
    } else if (typeof value === 'boolean' || value === null) {
      // allowed
    } else if (typeof value === 'object') {
      if (countDepth(value) > LIMITS.maxNestedDepth) {
        throw new AppError('Object nesting too deep', { status: 400, code });
      }
    } else {
      throw new AppError('Unsupported value type', { status: 400, code });
    }
  }
}

function validateStringArray(arr, { code, maxItems, maxItemLength }) {
  if (!Array.isArray(arr)) {
    throw new AppError('Expected an array', { status: 400, code });
  }
  if (arr.length > maxItems) {
    throw new AppError('Array is too long', { status: 400, code });
  }
  for (const item of arr) {
    if (typeof item !== 'string' || item.length === 0 || item.length > maxItemLength) {
      throw new AppError('Invalid array item', { status: 400, code });
    }
  }
}

/**
 * Validate and normalize a GhostProgress-compatible payload.
 * Rejects unknown top-level keys for schema stability.
 */
function validateProgressPayload(body) {
  assertPlainObject(body, 'invalid_progress', 'Progress body must be an object');

  for (const key of Object.keys(body)) {
    if (!PROGRESS_KEYS.includes(key)) {
      throw new AppError(`Unsupported progress field: ${key}`, {
        status: 400,
        code: 'unsupported_field'
      });
    }
  }

  const progress = {
    xp: 0,
    solved: [],
    streak: 0,
    lastDay: null,
    bestTimes: {},
    notes: {},
    quizScores: {},
    achievements: [],
    unlocks: [],
    preferences: {},
    settings: {}
  };

  if (Object.prototype.hasOwnProperty.call(body, 'xp')) {
    assertFiniteNumber(body.xp, 'invalid_xp', 'xp must be a finite number');
    if (body.xp < 0 || body.xp > LIMITS.maxXp) {
      throw new AppError(`xp must be between 0 and ${LIMITS.maxXp}`, {
        status: 400,
        code: 'invalid_xp'
      });
    }
    progress.xp = Math.floor(body.xp);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'solved')) {
    validateStringArray(body.solved, {
      code: 'invalid_solved',
      maxItems: LIMITS.maxSolved,
      maxItemLength: LIMITS.maxSolvedIdLength
    });
    progress.solved = [...body.solved];
  }

  if (Object.prototype.hasOwnProperty.call(body, 'streak')) {
    assertFiniteNumber(body.streak, 'invalid_streak', 'streak must be a finite number');
    if (body.streak < 0 || body.streak > LIMITS.maxStreak) {
      throw new AppError(`streak must be between 0 and ${LIMITS.maxStreak}`, {
        status: 400,
        code: 'invalid_streak'
      });
    }
    progress.streak = Math.floor(body.streak);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'lastDay')) {
    if (body.lastDay !== null && typeof body.lastDay !== 'string') {
      throw new AppError('lastDay must be a string or null', {
        status: 400,
        code: 'invalid_last_day'
      });
    }
    if (typeof body.lastDay === 'string' && body.lastDay.length > LIMITS.maxLastDayLength) {
      throw new AppError('lastDay is too long', { status: 400, code: 'invalid_last_day' });
    }
    progress.lastDay = body.lastDay;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'bestTimes')) {
    validateStringMap(body.bestTimes, {
      code: 'invalid_best_times',
      maxEntries: LIMITS.maxObjectKeys
    });
    progress.bestTimes = body.bestTimes;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
    validateStringMap(body.notes, {
      code: 'invalid_notes',
      maxEntries: LIMITS.maxNotesEntries
    });
    progress.notes = body.notes;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'quizScores')) {
    validateStringMap(body.quizScores, {
      code: 'invalid_quiz_scores',
      maxEntries: LIMITS.maxObjectKeys
    });
    progress.quizScores = body.quizScores;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'achievements')) {
    validateStringArray(body.achievements, {
      code: 'invalid_achievements',
      maxItems: LIMITS.maxAchievements,
      maxItemLength: LIMITS.maxSolvedIdLength
    });
    progress.achievements = [...body.achievements];
  }

  if (Object.prototype.hasOwnProperty.call(body, 'unlocks')) {
    validateStringArray(body.unlocks, {
      code: 'invalid_unlocks',
      maxItems: LIMITS.maxUnlocks,
      maxItemLength: LIMITS.maxSolvedIdLength
    });
    progress.unlocks = [...body.unlocks];
  }

  if (Object.prototype.hasOwnProperty.call(body, 'preferences')) {
    validateStringMap(body.preferences, {
      code: 'invalid_preferences',
      maxEntries: LIMITS.maxObjectKeys
    });
    progress.preferences = body.preferences;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'settings')) {
    validateStringMap(body.settings, {
      code: 'invalid_settings',
      maxEntries: LIMITS.maxObjectKeys
    });
    progress.settings = body.settings;
  }

  return progress;
}

module.exports = {
  PROGRESS_KEYS,
  LIMITS,
  validateProgressPayload
};
