'use strict';

/**
 * Electron security helpers (Phase 6).
 * Pure / injectable where possible so unit tests do not claim OS Keychain behavior.
 */

const SESSION_UNAVAILABLE = 'SESSION_UNAVAILABLE';
const SESSION_STORAGE_FAILED = 'SESSION_STORAGE_FAILED';

const AUTH_SCHEME = 'ghost-protocol';
const MAX_REFRESH_TOKEN_LENGTH = 8192;
const MAX_AUTH_CALLBACK_URL_LENGTH = 2048;
const SESSION_FILE_NAME = 'ghost-auth-session.json';
const SESSION_FORMAT_VERSION = 1;

function createSessionError(code) {
  const err = new Error(code);
  err.code = code;
  err.name = 'SessionError';
  return err;
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Production (packaged) API URLs must be HTTPS, except explicit loopback HTTP for local smoke.
 * Development may use loopback HTTP. Remote HTTP always fails closed.
 */
function assertApiBaseUrlAllowed(rawUrl, { isPackaged = false } = {}) {
  void isPackaged; // packaged and unpackaged share the same transport rules
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('Invalid API base URL');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid API base URL');
  }
  const normalized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || parsed.origin;
  if (parsed.protocol === 'https:') {
    return normalized;
  }
  // Explicit localhost/loopback HTTP only (dev / local smoke). Remote HTTP always fails closed.
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) {
    return normalized;
  }
  throw new Error('Insecure API base URL rejected');
}

function resolveApiBaseUrlFromEnv(env = process.env, { isPackaged = false, fallback = 'http://127.0.0.1:3000' } = {}) {
  const fromEnv = env.GHOST_API_BASE_URL || env.API_PUBLIC_URL;
  const candidate =
    typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim().replace(/\/+$/, '') : fallback;
  return assertApiBaseUrlAllowed(candidate, { isPackaged });
}

function buildContentSecurityPolicy(apiBaseUrl) {
  const hosts = new Set(["'self'", apiBaseUrl]);
  try {
    const parsed = new URL(apiBaseUrl);
    if (isLoopbackHostname(parsed.hostname)) {
      hosts.add('http://127.0.0.1:3000');
      hosts.add('http://localhost:3000');
    }
  } catch {
    // apiBaseUrl already validated at startup
  }
  const connectSrc = [...hosts].join(' ');
  // unsafe-inline required for monolithic index.html scripts/styles. No unsafe-eval.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

function isAllowedExternalHttpsUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (url.length > 4096) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

/**
 * Strict validation for dormant OAuth deep links.
 * Accepts only ghost-protocol://auth/callback with optional query.
 * Does NOT imply authentication success.
 */
function parseAuthCallbackUrl(url) {
  if (typeof url !== 'string' || !url) {
    return { ok: false, reason: 'not_string' };
  }
  if (url.length > MAX_AUTH_CALLBACK_URL_LENGTH) {
    return { ok: false, reason: 'too_long' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.protocol !== `${AUTH_SCHEME}:`) {
    return { ok: false, reason: 'scheme' };
  }
  if (parsed.hostname !== 'auth') {
    return { ok: false, reason: 'host' };
  }
  const path = parsed.pathname === '' ? '/' : parsed.pathname;
  if (path !== '/callback') {
    return { ok: false, reason: 'path' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'userinfo' };
  }
  if (parsed.port) {
    return { ok: false, reason: 'port' };
  }
  return { ok: true, url: `${AUTH_SCHEME}://auth/callback${parsed.search || ''}` };
}

function isAuthCallback(url) {
  return parseAuthCallbackUrl(url).ok;
}

function validateRefreshTokenInput(token) {
  if (token === null || token === undefined || token === '') return null;
  if (typeof token !== 'string') {
    throw createSessionError(SESSION_STORAGE_FAILED);
  }
  if (token.length > MAX_REFRESH_TOKEN_LENGTH) {
    throw createSessionError(SESSION_STORAGE_FAILED);
  }
  return token;
}

/**
 * Determine whether Electron safeStorage is acceptable for persistence.
 * Rejects Linux basic_text (not OS-secret-store backed).
 * Unit tests inject safeStorage; they do not prove Keychain/DPAPI.
 */
function isSecurePersistenceAvailable(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    return false;
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
  } catch {
    return false;
  }
  if (typeof safeStorage.getSelectedStorageBackend === 'function') {
    try {
      const backend = safeStorage.getSelectedStorageBackend();
      if (backend === 'basic_text' || backend === 'unknown') {
        return false;
      }
    } catch {
      // Older Electron without backend introspection: rely on isEncryptionAvailable.
    }
  }
  return typeof safeStorage.encryptString === 'function' && typeof safeStorage.decryptString === 'function';
}

function encodeCipherPayload(buffer) {
  return Buffer.from(buffer).toString('base64');
}

function decodeCipherPayload(base64) {
  return Buffer.from(base64, 'base64');
}

/**
 * Credential store: encrypt-at-rest via injected safeStorage, persist under fixed userData path.
 * NEVER writes plaintext refresh tokens. If secure storage unavailable → non-persistent / errors.
 */
function createCredentialStore({
  userDataPath,
  fs,
  safeStorage,
  fileName = SESSION_FILE_NAME
}) {
  const filePath = require('node:path').join(userDataPath, fileName);

  function unlinkQuiet() {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // absent
    }
  }

  function readRaw() {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  function parseEnvelope(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function store(token) {
    const validated = validateRefreshTokenInput(token);
    if (!validated) {
      unlinkQuiet();
      return true;
    }
    if (!isSecurePersistenceAvailable(safeStorage)) {
      unlinkQuiet();
      throw createSessionError(SESSION_STORAGE_FAILED);
    }
    let encrypted;
    try {
      encrypted = safeStorage.encryptString(validated);
    } catch {
      unlinkQuiet();
      throw createSessionError(SESSION_STORAGE_FAILED);
    }
    const envelope = {
      v: SESSION_FORMAT_VERSION,
      algo: 'electron-safeStorage',
      ciphertext: encodeCipherPayload(encrypted)
    };
    try {
      fs.writeFileSync(filePath, JSON.stringify(envelope), { mode: 0o600 });
    } catch {
      throw createSessionError(SESSION_STORAGE_FAILED);
    }
    return true;
  }

  function load() {
    const raw = readRaw();
    if (!raw) return null;

    const parsed = parseEnvelope(raw);
    if (!parsed || typeof parsed !== 'object') {
      unlinkQuiet();
      return null;
    }

    // Legacy Phase 5 plaintext envelope — never keep plaintext on disk.
    if (typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
      unlinkQuiet();
      if (!isSecurePersistenceAvailable(safeStorage)) {
        return null;
      }
      try {
        store(parsed.refreshToken);
        return parsed.refreshToken;
      } catch {
        unlinkQuiet();
        return null;
      }
    }

    if (
      parsed.v !== SESSION_FORMAT_VERSION ||
      parsed.algo !== 'electron-safeStorage' ||
      typeof parsed.ciphertext !== 'string' ||
      !parsed.ciphertext
    ) {
      unlinkQuiet();
      return null;
    }

    if (!isSecurePersistenceAvailable(safeStorage)) {
      // Do not leave undecryptable material; force re-login.
      unlinkQuiet();
      throw createSessionError(SESSION_UNAVAILABLE);
    }

    try {
      const plain = safeStorage.decryptString(decodeCipherPayload(parsed.ciphertext));
      if (typeof plain !== 'string' || !plain) {
        unlinkQuiet();
        return null;
      }
      return plain;
    } catch {
      unlinkQuiet();
      throw createSessionError(SESSION_UNAVAILABLE);
    }
  }

  function clear() {
    unlinkQuiet();
    return true;
  }

  return {
    filePath,
    store,
    load,
    clear,
    isSecurePersistenceAvailable: () => isSecurePersistenceAvailable(safeStorage)
  };
}

const SECURE_WEB_PREFERENCES = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  experimentalFeatures: false
});

const PRELOAD_API_ALLOWLIST = Object.freeze([
  'apiBaseUrl',
  'authSession',
  'beginOAuth',
  'onAuthCallback'
]);

const IPC_CHANNEL_ALLOWLIST = Object.freeze([
  'auth:get-api-base-sync',
  'auth-session:store',
  'auth-session:load',
  'auth-session:clear',
  'auth:open-oauth',
  'auth:callback'
]);

function shouldAllowInAppNavigation(currentUrl, targetUrl) {
  if (typeof targetUrl !== 'string' || !targetUrl) return false;
  if (targetUrl === currentUrl) return true;
  // Deny javascript:, data:, custom schemes, and any off-document navigation.
  try {
    const target = new URL(targetUrl);
    if (target.protocol === 'javascript:' || target.protocol === 'data:' || target.protocol === 'file:') {
      // file: only allowed when identical to current document URL (handled above).
      return false;
    }
  } catch {
    return false;
  }
  return false;
}

module.exports = {
  SESSION_UNAVAILABLE,
  SESSION_STORAGE_FAILED,
  AUTH_SCHEME,
  MAX_REFRESH_TOKEN_LENGTH,
  MAX_AUTH_CALLBACK_URL_LENGTH,
  SESSION_FILE_NAME,
  SESSION_FORMAT_VERSION,
  SECURE_WEB_PREFERENCES,
  PRELOAD_API_ALLOWLIST,
  IPC_CHANNEL_ALLOWLIST,
  createSessionError,
  isLoopbackHostname,
  assertApiBaseUrlAllowed,
  resolveApiBaseUrlFromEnv,
  buildContentSecurityPolicy,
  isAllowedExternalHttpsUrl,
  parseAuthCallbackUrl,
  isAuthCallback,
  validateRefreshTokenInput,
  isSecurePersistenceAvailable,
  createCredentialStore,
  shouldAllowInAppNavigation
};
