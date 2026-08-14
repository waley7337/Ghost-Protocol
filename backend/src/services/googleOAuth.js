'use strict';

/**
 * Google OAuth (authorization code) — server-side only.
 * Secrets never leave the API. Clients receive the same JWT session bundle as email auth.
 */

const crypto = require('node:crypto');
const { SignJWT, jwtVerify, createRemoteJWKSet } = require('jose');
const { query, DatabaseError, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { isGoogleOAuthConfigured } = require('../config');
const { parseAllowedOrigins } = require('../middleware/cors');
const { createSession } = require('./sessions');
const { normalizeEmail, publicUser } = require('./users');

/** Neutral conflict — do not reveal whether the existing account is password or Google-linked. */
const ACCOUNT_CONFLICT_MESSAGE =
  'An account already exists for this email. Sign in using your existing method.';

function accountConflictError() {
  return new AppError(ACCOUNT_CONFLICT_MESSAGE, {
    status: 409,
    code: 'account_conflict'
  });
}

function isUniqueViolation(error) {
  return (
    (error instanceof DatabaseError && error.code === '23505') ||
    error?.code === '23505'
  );
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const STATE_TTL_SECONDS = 600;
const EXCHANGE_TTL_SECONDS = 120;
const ELECTRON_RETURN = 'ghost-protocol://auth/callback';

/**
 * Cached remote JWKS for Google ID token signature verification (M4).
 * jose `createRemoteJWKSet` does NOT fetch on every verify:
 * - `cacheMaxAge` (default 600_000 ms / 10 min): keys are reused while fresh
 * - `cooldownDuration` (default 30_000 ms): after a fetch, rate-limits reload storms
 * - On `JWKSNoMatchingKey` (rotated kid), reloads once if not cooling down
 * See jose RemoteJWKSetImpl.getKey / reload.
 */
const defaultGoogleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), {
  cacheMaxAge: 600_000,
  cooldownDuration: 30_000,
  timeoutDuration: 5_000
});

function requireGoogleConfig(config) {
  if (!isGoogleOAuthConfigured(config)) {
    throw new AppError('Google sign-in is not configured', {
      status: 503,
      code: 'google_not_configured'
    });
  }
}

function stateSecretKey(config) {
  return crypto.createHash('sha256').update(`google-oauth-state:${config.accessTokenSecret}`).digest();
}

async function signOAuthState(config, payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .setIssuer(config.jwtIssuer)
    .setAudience('ghost-protocol-google-oauth')
    .sign(stateSecretKey(config));
}

async function verifyOAuthState(config, state) {
  if (typeof state !== 'string' || !state) {
    throw new AppError('Invalid OAuth state', { status: 400, code: 'invalid_oauth_state' });
  }
  try {
    const { payload } = await jwtVerify(state, stateSecretKey(config), {
      issuer: config.jwtIssuer,
      audience: 'ghost-protocol-google-oauth',
      algorithms: ['HS256']
    });
    if (payload.typ !== 'google_oauth_state' || typeof payload.returnTo !== 'string') {
      throw new AppError('Invalid OAuth state', { status: 400, code: 'invalid_oauth_state' });
    }
    return payload;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Invalid or expired OAuth state', {
      status: 400,
      code: 'invalid_oauth_state'
    });
  }
}

function hashExchangeCode(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

function resolveReturnTo(config, { returnTo, platform } = {}) {
  if (platform === 'electron') {
    return ELECTRON_RETURN;
  }

  const allowed = parseAllowedOrigins(config);
  const candidates = [];
  if (typeof returnTo === 'string' && returnTo.trim()) {
    candidates.push(returnTo.trim());
  }
  if (typeof config.frontendUrl === 'string' && config.frontendUrl.trim()) {
    const first = config.frontendUrl.split(',')[0].trim().replace(/\/+$/, '');
    if (first) candidates.push(first + '/');
  }

  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;
    if (parsed.username || parsed.password) continue;
    const origin = parsed.origin;
    if (!allowed.has(origin)) continue;
    // Keep path; drop hash/search from attacker-controlled return_to
    const path = parsed.pathname || '/';
    return `${origin}${path === '/' ? '/' : path}`;
  }

  throw new AppError('Invalid return URL for Google sign-in', {
    status: 400,
    code: 'invalid_return_to'
  });
}

function buildGoogleAuthorizeUrl(config, state, { nonce } = {}) {
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account'
  });
  if (typeof nonce === 'string' && nonce) {
    params.set('nonce', nonce);
  }
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function startGoogleOAuth(config, { returnTo, platform } = {}) {
  requireGoogleConfig(config);
  const resolvedReturnTo = resolveReturnTo(config, { returnTo, platform });
  const nonce = crypto.randomBytes(24).toString('base64url');
  const state = await signOAuthState(config, {
    typ: 'google_oauth_state',
    nonce,
    returnTo: resolvedReturnTo,
    platform: platform === 'electron' ? 'electron' : 'web'
  });
  return {
    url: buildGoogleAuthorizeUrl(config, state, { nonce }),
    returnTo: resolvedReturnTo
  };
}

/**
 * Verify Google ID token signature via JWKS, then assert iss/aud/exp/sub/email claims.
 * Optional expectedNonce must match the OpenID nonce claim (bound to signed OAuth state).
 */
async function verifyGoogleIdToken(
  config,
  idToken,
  { expectedNonce, jwks = defaultGoogleJwks } = {}
) {
  if (typeof idToken !== 'string' || !idToken) {
    throw new AppError('Google identity token missing', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.googleClientId,
      algorithms: ['RS256']
    }));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Google identity token invalid', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }

  if (typeof expectedNonce === 'string' && expectedNonce) {
    if (typeof payload.nonce !== 'string' || payload.nonce !== expectedNonce) {
      throw new AppError('Google identity nonce mismatch', {
        status: 400,
        code: 'google_identity_invalid'
      });
    }
  }

  return assertGoogleIdentity(config, payload);
}

function assertGoogleIdentity(config, claims) {
  if (!claims || typeof claims !== 'object') {
    throw new AppError('Google identity token invalid', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }
  if (!GOOGLE_ISSUERS.has(claims.iss)) {
    throw new AppError('Google identity issuer invalid', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.googleClientId)) {
    throw new AppError('Google identity audience invalid', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
    throw new AppError('Google identity token expired', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) {
    throw new AppError('Google identity subject missing', {
      status: 400,
      code: 'google_identity_invalid'
    });
  }
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new AppError('Google email is not verified', {
      status: 400,
      code: 'google_email_unverified'
    });
  }
  const email = normalizeEmail(claims.email);
  if (!email) {
    throw new AppError('Google account email is required', {
      status: 400,
      code: 'google_email_missing'
    });
  }
  return {
    googleSub: claims.sub,
    email,
    name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) : null,
    picture: typeof claims.picture === 'string' && /^https:\/\//i.test(claims.picture)
      ? claims.picture.slice(0, 2048)
      : null
  };
}

async function exchangeCodeWithGoogle(
  config,
  code,
  { fetchImpl = fetch, expectedNonce, jwks } = {}
) {
  if (typeof code !== 'string' || !code) {
    throw new AppError('Missing Google authorization code', {
      status: 400,
      code: 'google_code_missing'
    });
  }

  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: config.googleRedirectUri,
    grant_type: 'authorization_code'
  });

  let response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body
    });
  } catch {
    throw new AppError('Unable to reach Google token endpoint', {
      status: 502,
      code: 'google_token_unreachable'
    });
  }

  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok || !json?.id_token) {
    throw new AppError('Google authorization failed', {
      status: 400,
      code: 'google_token_exchange_failed'
    });
  }

  return verifyGoogleIdToken(config, json.id_token, { expectedNonce, jwks });
}

/**
 * Account resolution (Phase 9 WP2 / H1 — no email auto-link):
 * 1) Match google_sub → sign-in (preserve already-linked Google users)
 * 2) Match email for a *different* / unlinked account → refuse (neutral account_conflict)
 * 3) Else create passwordless user with google_sub
 *
 * Never attach a new Google identity to an existing account solely because emails match.
 * Explicit authenticated linking is intentionally out of scope (track separately).
 * Decision runs in a transaction; unique(email)/unique(google_sub) races re-resolve
 * without auto-linking.
 */
async function signInExistingGoogleUser(client, user, identity) {
  if (user.email !== identity.email) {
    // Keep historical email; do not silently rewrite on conflict with another account.
    const emailOwner = await query(
      client,
      `SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1`,
      [identity.email, user.id]
    );
    if (emailOwner.rows[0]) {
      throw new AppError('Google account email conflicts with an existing account', {
        status: 409,
        code: 'google_email_conflict'
      });
    }
  }
  if (!user.email_verified) {
    await query(
      client,
      `UPDATE users SET email_verified = TRUE, updated_at = now() WHERE id = $1`,
      [user.id]
    );
    user.email_verified = true;
  }
  return { user: publicUser(user), created: false, linked: false };
}

async function resolveGoogleUserAfterUniqueRace(pool, identity) {
  return withTransaction(pool, async (client) => {
    const bySub = await query(
      client,
      `SELECT id, email, password_hash, email_verified, google_sub, created_at
       FROM users
       WHERE google_sub = $1
       LIMIT 1
       FOR UPDATE`,
      [identity.googleSub]
    );
    if (bySub.rows[0]) {
      return signInExistingGoogleUser(client, bySub.rows[0], identity);
    }
    // Email or google_sub lost a race to another row — never auto-link.
    throw accountConflictError();
  });
}

async function findOrCreateGoogleUser(pool, identity) {
  const email = normalizeEmail(identity.email);
  if (!email) {
    throw new AppError('Google account email is required', {
      status: 400,
      code: 'google_email_missing'
    });
  }
  const normalizedIdentity = { ...identity, email };

  try {
    return await withTransaction(pool, async (client) => {
      const bySub = await query(
        client,
        `SELECT id, email, password_hash, email_verified, google_sub, created_at
         FROM users
         WHERE google_sub = $1
         LIMIT 1
         FOR UPDATE`,
        [normalizedIdentity.googleSub]
      );
      if (bySub.rows[0]) {
        return signInExistingGoogleUser(client, bySub.rows[0], normalizedIdentity);
      }

      const byEmail = await query(
        client,
        `SELECT id, email, password_hash, email_verified, google_sub, created_at
         FROM users
         WHERE email = $1
         LIMIT 1
         FOR UPDATE`,
        [normalizedIdentity.email]
      );

      if (byEmail.rows[0]) {
        const existing = byEmail.rows[0];
        if (existing.google_sub === normalizedIdentity.googleSub) {
          return signInExistingGoogleUser(client, existing, normalizedIdentity);
        }
        // Password account, different Google subject, or any other email occupant:
        // never auto-link; never issue a session for this Google identity.
        throw accountConflictError();
      }

      const inserted = await query(
        client,
        `INSERT INTO users (email, password_hash, email_verified, google_sub)
         VALUES ($1, NULL, TRUE, $2)
         RETURNING id, email, email_verified, google_sub, created_at`,
        [normalizedIdentity.email, normalizedIdentity.googleSub]
      );
      return { user: publicUser(inserted.rows[0]), created: true, linked: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return resolveGoogleUserAfterUniqueRace(pool, normalizedIdentity);
    }
    throw error;
  }
}

async function maybeSeedGoogleProfile(pool, userId, identity) {
  if (!identity.name && !identity.picture) return;
  try {
    await query(
      pool,
      `INSERT INTO profiles (user_id, name, avatar_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE
       SET
         name = CASE
           WHEN profiles.name IS NULL OR profiles.name = 'Operative' THEN EXCLUDED.name
           ELSE profiles.name
         END,
         avatar_url = COALESCE(profiles.avatar_url, EXCLUDED.avatar_url),
         updated_at = now()`,
      [userId, identity.name || 'Operative', identity.picture]
    );
  } catch {
    // Profile seeding is best-effort; auth must still succeed.
  }
}

async function storeExchangeBundle(pool, bundle) {
  const code = crypto.randomBytes(32).toString('base64url');
  const codeHash = hashExchangeCode(code);
  const expiresAt = new Date(Date.now() + EXCHANGE_TTL_SECONDS * 1000);
  const payload = {
    accessToken: bundle.accessToken,
    refreshToken: bundle.refreshToken,
    tokenType: 'Bearer',
    expiresIn: bundle.accessTokenExpiresIn,
    session: {
      id: bundle.session.id,
      expiresAt: bundle.session.expires_at
    },
    user: bundle.user
  };
  await query(
    pool,
    `INSERT INTO oauth_exchanges (code_hash, bundle_json, expires_at)
     VALUES ($1, $2, $3)`,
    [codeHash, JSON.stringify(payload), expiresAt.toISOString()]
  );
  return code;
}

async function consumeExchangeCode(pool, code) {
  if (typeof code !== 'string' || !code || code.length > 512) {
    throw new AppError('Invalid Google exchange code', {
      status: 400,
      code: 'invalid_exchange_code'
    });
  }
  const codeHash = hashExchangeCode(code);
  const result = await query(
    pool,
    `UPDATE oauth_exchanges
     SET consumed_at = now()
     WHERE code_hash = $1
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING bundle_json`,
    [codeHash]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError('Invalid or expired Google exchange code', {
      status: 400,
      code: 'invalid_exchange_code'
    });
  }
  try {
    return JSON.parse(row.bundle_json);
  } catch {
    throw new AppError('Invalid Google exchange payload', {
      status: 500,
      code: 'invalid_exchange_payload'
    });
  }
}

/**
 * M5: deliver OAuth callback params in the URL fragment (not query) so exchange
 * codes and error codes are less exposed via Referer / server access logs.
 * Do not put human-readable error messages in the redirect URL.
 */
function appendFragmentParams(returnTo, params) {
  const url = new URL(returnTo);
  url.search = '';
  const fragment = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      fragment.set(key, String(value));
    }
  }
  url.hash = fragment.toString();
  return url.toString();
}

async function completeGoogleOAuth(
  pool,
  config,
  { code, state, error, errorDescription, fetchImpl = fetch, jwks, userAgent, ipAddress } = {}
) {
  requireGoogleConfig(config);

  let returnTo = null;
  try {
    if (state) {
      const payload = await verifyOAuthState(config, state);
      returnTo = payload.returnTo;
    }
  } catch {
    returnTo = null;
  }

  // errorDescription is intentionally unused in redirects (reduce URL leakage).
  void errorDescription;

  const fail = (errCode, message) => {
    if (!returnTo) {
      throw new AppError(message, { status: 400, code: errCode });
    }
    return {
      redirectTo: appendFragmentParams(returnTo, {
        google_error: errCode
      })
    };
  };

  if (error) {
    const codeMap = {
      access_denied: 'google_cancelled',
      immediately_unavailable: 'google_unavailable'
    };
    return fail(
      codeMap[error] || 'google_rejected',
      'Google sign-in was cancelled or rejected'
    );
  }

  if (!state) {
    return fail('invalid_oauth_state', 'Missing OAuth state');
  }

  let statePayload;
  try {
    statePayload = await verifyOAuthState(config, state);
    returnTo = statePayload.returnTo;
  } catch {
    return fail('invalid_oauth_state', 'Invalid or expired OAuth state');
  }

  const expectedNonce =
    typeof statePayload.nonce === 'string' && statePayload.nonce ? statePayload.nonce : null;

  let identity;
  try {
    identity = await exchangeCodeWithGoogle(config, code, {
      fetchImpl,
      expectedNonce,
      jwks
    });
  } catch (err) {
    const codeName = err instanceof AppError ? err.code : 'google_token_exchange_failed';
    const message = err instanceof AppError ? err.message : 'Google authorization failed';
    return fail(codeName, message);
  }

  try {
    const { user } = await findOrCreateGoogleUser(pool, identity);
    await maybeSeedGoogleProfile(pool, user.id, identity);
    const sessionBundle = await createSession(pool, config, {
      userId: user.id,
      userAgent,
      ipAddress
    });
    const exchangeCode = await storeExchangeBundle(pool, { ...sessionBundle, user });
    return {
      redirectTo: appendFragmentParams(returnTo, { google_exchange: exchangeCode })
    };
  } catch (err) {
    const codeName = err instanceof AppError ? err.code : 'google_signin_failed';
    const message = err instanceof AppError ? err.message : 'Google sign-in failed';
    return fail(codeName, message);
  }
}

module.exports = {
  ELECTRON_RETURN,
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  GOOGLE_JWKS_URL,
  startGoogleOAuth,
  completeGoogleOAuth,
  consumeExchangeCode,
  findOrCreateGoogleUser,
  exchangeCodeWithGoogle,
  verifyGoogleIdToken,
  assertGoogleIdentity,
  resolveReturnTo,
  verifyOAuthState,
  signOAuthState,
  buildGoogleAuthorizeUrl,
  appendFragmentParams,
  requireGoogleConfig,
  hashExchangeCode
};
