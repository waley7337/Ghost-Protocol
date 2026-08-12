'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { createSession, rotateRefreshSession } = require('../src/services/sessions');
const { hashPassword } = require('../src/services/passwords');
const { query } = require('../src/db');

function createMemoryPool() {
  const users = new Map();
  const sessions = new Map();
  let userSeq = 0;
  let sessionSeq = 0;

  async function exec(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };

    if (sql.startsWith('INSERT INTO users')) {
      userSeq += 1;
      const id = `00000000-0000-4000-8000-${String(userSeq).padStart(12, '0')}`;
      const row = {
        id,
        email: params[0],
        password_hash: params[1],
        email_verified: false,
        created_at: new Date().toISOString()
      };
      users.set(id, row);
      return { rows: [row] };
    }

    if (sql.startsWith('INSERT INTO sessions')) {
      let userId;
      let familyId;
      let parentSessionId = null;
      let refreshTokenHash;
      let expiresAt;
      let userAgent = null;
      let ipAddress = null;
      if (sql.includes('family_id, parent_session_id, refresh_token_hash')) {
        [userId, familyId, parentSessionId, refreshTokenHash, expiresAt, userAgent, ipAddress] =
          params;
      } else {
        [userId, familyId, refreshTokenHash, expiresAt, userAgent, ipAddress] = params;
      }
      for (const existing of sessions.values()) {
        if (existing.family_id === familyId && existing.revoked_at == null) {
          const error = new Error('unique');
          error.code = '23505';
          throw error;
        }
      }
      sessionSeq += 1;
      const id = `10000000-0000-4000-8000-${String(sessionSeq).padStart(12, '0')}`;
      const row = {
        id,
        user_id: userId,
        family_id: familyId,
        parent_session_id: parentSessionId,
        replaced_by_session_id: null,
        refresh_token_hash: refreshTokenHash,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        revoked_at: null,
        last_used_at: new Date().toISOString(),
        user_agent: userAgent,
        ip_address: ipAddress
      };
      sessions.set(id, row);
      return { rows: [row] };
    }

    if (sql.includes('FROM sessions WHERE refresh_token_hash')) {
      const row = [...sessions.values()].find((s) => s.refresh_token_hash === params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (sql.includes('SET replaced_by_session_id = $2') && !sql.includes('revoked_at')) {
      const row = sessions.get(params[0]);
      if (row) row.replaced_by_session_id = params[1];
      return { rows: [] };
    }

    if (sql.startsWith('UPDATE sessions SET revoked_at') && sql.includes('WHERE id')) {
      const row = sessions.get(params[0]);
      if (row && !row.revoked_at) {
        row.revoked_at = new Date().toISOString();
        row.last_used_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    if (sql.includes('WHERE family_id = $1')) {
      for (const row of sessions.values()) {
        if (row.family_id === params[0] && row.revoked_at == null) {
          row.revoked_at = new Date().toISOString();
        }
      }
      return { rows: [] };
    }

    throw new Error(`Unhandled SQL: ${sql}`);
  }

  return {
    query: exec,
    async connect() {
      return { query: exec, release() {} };
    },
    _sessions: sessions
  };
}

test('direct rotateRefreshSession A->B works on memory pool', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    ACCESS_TOKEN_SECRET: 'test-access-secret-at-least-32-chars-long',
    REFRESH_TOKEN_SECRET: 'test-refresh-secret-at-least-32-chars-long'
  });
  const pool = createMemoryPool();
  const passwordHash = await hashPassword('correct-horse');
  const user = await query(
    pool,
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, email_verified, created_at`,
    ['direct@example.com', passwordHash]
  );
  const initial = await createSession(pool, config, { userId: user.rows[0].id });
  assert.ok(initial.refreshToken);
  const { hashRefreshToken } = require('../src/services/tokens');
  const expectHash = hashRefreshToken(initial.refreshToken, config.refreshTokenSecret);
  const stored = [...pool._sessions.values()];
  assert.equal(stored.length, 1);
  assert.equal(stored[0].refresh_token_hash, expectHash);
  const rotated = await rotateRefreshSession(pool, config, initial.refreshToken);
  assert.ok(rotated.refreshToken);
  assert.notEqual(rotated.refreshToken, initial.refreshToken);
});
