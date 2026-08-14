/**
 * UNIT Electron security tests (Phase 6).
 * Uses simulated safeStorage — does NOT prove OS Keychain/DPAPI.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const security = require('../../electron/security.cjs');
const preloadSource = fs.readFileSync(path.join(__dirname, '../../electron/preload.cjs'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '../../electron/main.cjs'), 'utf8');

function makeMockSafeStorage({
  available = true,
  backend = 'keychain',
  brokenEncrypt = false,
  brokenDecrypt = false
} = {}) {
  const map = new Map();
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString(plain) {
      if (!available || brokenEncrypt) throw new Error('encrypt failed');
      const buf = Buffer.from(`enc:${plain}`, 'utf8');
      map.set(buf.toString('base64'), plain);
      return buf;
    },
    decryptString(buf) {
      if (!available || brokenDecrypt) throw new Error('decrypt failed');
      const key = Buffer.from(buf).toString('base64');
      const plain = map.get(key) || Buffer.from(buf).toString('utf8').replace(/^enc:/, '');
      if (!plain) throw new Error('decrypt failed');
      return plain;
    }
  };
}

test('SECURE_WEB_PREFERENCES enforces isolation and sandbox', () => {
  assert.equal(security.SECURE_WEB_PREFERENCES.contextIsolation, true);
  assert.equal(security.SECURE_WEB_PREFERENCES.nodeIntegration, false);
  assert.equal(security.SECURE_WEB_PREFERENCES.sandbox, true);
  assert.equal(security.SECURE_WEB_PREFERENCES.webSecurity, true);
  assert.equal(security.SECURE_WEB_PREFERENCES.allowRunningInsecureContent, false);
  assert.equal(security.SECURE_WEB_PREFERENCES.webviewTag, false);
  assert.equal(security.SECURE_WEB_PREFERENCES.nodeIntegrationInWorker, false);
  assert.equal(security.SECURE_WEB_PREFERENCES.nodeIntegrationInSubFrames, false);
  assert.equal(security.SECURE_WEB_PREFERENCES.experimentalFeatures, false);
});

test('main.cjs applies SECURE_WEB_PREFERENCES and disables dangerous flags', () => {
  assert.match(mainSource, /SECURE_WEB_PREFERENCES/);
  assert.doesNotMatch(mainSource, /nodeIntegration:\s*true/);
  assert.doesNotMatch(mainSource, /sandbox:\s*false/);
  assert.doesNotMatch(mainSource, /webSecurity:\s*false/);
  assert.doesNotMatch(mainSource, /allowRunningInsecureContent:\s*true/);
});

test('preload API allowlist is narrow and has no generic IPC', () => {
  for (const key of security.PRELOAD_API_ALLOWLIST) {
    assert.match(preloadSource, new RegExp(key));
  }
  assert.match(preloadSource, /authSession/);
  assert.match(preloadSource, /store:/);
  assert.match(preloadSource, /load:/);
  assert.match(preloadSource, /clear:/);
  assert.doesNotMatch(preloadSource, /\bfs\b/);
  assert.doesNotMatch(preloadSource, /child_process/);
  assert.doesNotMatch(preloadSource, /invoke\(channel/);
  assert.doesNotMatch(preloadSource, /getRefreshToken/);
  assert.doesNotMatch(preloadSource, /setRefreshToken/);
});

test('IPC channel allowlist is explicit', () => {
  assert.ok(security.IPC_CHANNEL_ALLOWLIST.includes('auth-session:store'));
  assert.ok(security.IPC_CHANNEL_ALLOWLIST.includes('auth-session:load'));
  assert.ok(security.IPC_CHANNEL_ALLOWLIST.includes('auth-session:clear'));
  assert.ok(!security.IPC_CHANNEL_ALLOWLIST.some((c) => c.includes('*')));
});

test('production HTTPS API accepted; remote HTTP rejected; loopback HTTP allowed', () => {
  assert.equal(
    security.assertApiBaseUrlAllowed('https://api.example.com/'),
    'https://api.example.com'
  );
  assert.equal(
    security.assertApiBaseUrlAllowed('http://127.0.0.1:3000'),
    'http://127.0.0.1:3000'
  );
  assert.equal(
    security.assertApiBaseUrlAllowed('http://localhost:3000/'),
    'http://localhost:3000'
  );
  assert.throws(() => security.assertApiBaseUrlAllowed('http://api.example.com'), /Insecure/);
  assert.throws(() => security.assertApiBaseUrlAllowed('ftp://example.com'), /Insecure|Invalid/);
});

const PACKAGED_API_FALLBACK = 'https://ghost-protocol-production-f7ef.up.railway.app';

test('resolveApiBaseUrlFromEnv: explicit HTTPS GHOST_API_BASE_URL wins', () => {
  assert.equal(
    security.resolveApiBaseUrlFromEnv(
      { GHOST_API_BASE_URL: 'https://api.example.com/' },
      { isPackaged: true, fallback: PACKAGED_API_FALLBACK }
    ),
    'https://api.example.com'
  );
  assert.equal(
    security.resolveApiBaseUrlFromEnv(
      { API_PUBLIC_URL: 'https://other.example.com' },
      { isPackaged: false, fallback: 'http://127.0.0.1:3000' }
    ),
    'https://other.example.com'
  );
});

test('resolveApiBaseUrlFromEnv: development fallback may be loopback', () => {
  assert.equal(
    security.resolveApiBaseUrlFromEnv({}, { isPackaged: false, fallback: 'http://127.0.0.1:3000' }),
    'http://127.0.0.1:3000'
  );
});

test('resolveApiBaseUrlFromEnv: packaged fallback resolves to Railway HTTPS when supplied', () => {
  assert.equal(
    security.resolveApiBaseUrlFromEnv({}, { isPackaged: true, fallback: PACKAGED_API_FALLBACK }),
    PACKAGED_API_FALLBACK
  );
});

test('resolveApiBaseUrlFromEnv: insecure remote HTTP is rejected', () => {
  assert.throws(
    () =>
      security.resolveApiBaseUrlFromEnv(
        { GHOST_API_BASE_URL: 'http://api.example.com' },
        { isPackaged: true, fallback: PACKAGED_API_FALLBACK }
      ),
    /Insecure/
  );
});

test('preload fails closed on sync API base IPC failure (no localhost invent)', () => {
  assert.match(preloadSource, /return null/);
  assert.doesNotMatch(
    preloadSource,
    /catch\s*\{[^}]*return\s+['"]http:\/\/127\.0\.0\.1:3000['"]/s
  );
});

test('credential store encrypts at rest and never writes plaintext refreshToken field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-cred-'));
  const safeStorage = makeMockSafeStorage();
  const store = security.createCredentialStore({
    userDataPath: dir,
    fs,
    safeStorage
  });

  store.store('refresh-secret-value');
  const raw = fs.readFileSync(store.filePath, 'utf8');
  assert.doesNotMatch(raw, /refresh-secret-value/);
  assert.doesNotMatch(raw, /"refreshToken"/);
  assert.match(raw, /electron-safeStorage/);
  assert.equal(store.load(), 'refresh-secret-value');
  store.clear();
  assert.equal(store.load(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('secure-storage unavailable → NO plaintext persistence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-cred-'));
  const store = security.createCredentialStore({
    userDataPath: dir,
    fs,
    safeStorage: makeMockSafeStorage({ available: false })
  });

  assert.throws(() => store.store('token-should-not-persist'), (err) => {
    assert.equal(err.code, security.SESSION_STORAGE_FAILED);
    return true;
  });
  assert.equal(fs.existsSync(store.filePath), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Linux basic_text backend is treated as unavailable for persistence', () => {
  assert.equal(
    security.isSecurePersistenceAvailable(
      makeMockSafeStorage({ available: true, backend: 'basic_text' })
    ),
    false
  );
});

test('legacy plaintext session file is removed and not kept as plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-cred-'));
  const filePath = path.join(dir, security.SESSION_FILE_NAME);
  fs.writeFileSync(filePath, JSON.stringify({ refreshToken: 'legacy-plain' }), 'utf8');

  const unavailable = security.createCredentialStore({
    userDataPath: dir,
    fs,
    safeStorage: makeMockSafeStorage({ available: false })
  });
  assert.equal(unavailable.load(), null);
  assert.equal(fs.existsSync(filePath), false);

  fs.writeFileSync(filePath, JSON.stringify({ refreshToken: 'legacy-plain-2' }), 'utf8');
  const available = security.createCredentialStore({
    userDataPath: dir,
    fs,
    safeStorage: makeMockSafeStorage({ available: true })
  });
  assert.equal(available.load(), 'legacy-plain-2');
  const migrated = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(migrated, /legacy-plain-2/);
  assert.match(migrated, /ciphertext/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('malformed credential inputs are rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-cred-'));
  const store = security.createCredentialStore({
    userDataPath: dir,
    fs,
    safeStorage: makeMockSafeStorage()
  });
  assert.throws(() => store.store({ evil: true }), (err) => err.code === security.SESSION_STORAGE_FAILED);
  assert.throws(
    () => store.store('x'.repeat(security.MAX_REFRESH_TOKEN_LENGTH + 1)),
    (err) => err.code === security.SESSION_STORAGE_FAILED
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('navigation policy blocks unexpected targets', () => {
  const current = 'file:///Users/test/Ghost%20Protocol%20SaaS/index.html';
  assert.equal(security.shouldAllowInAppNavigation(current, current), true);
  assert.equal(security.shouldAllowInAppNavigation(current, 'https://evil.example'), false);
  assert.equal(security.shouldAllowInAppNavigation(current, 'javascript:alert(1)'), false);
  assert.equal(security.shouldAllowInAppNavigation(current, 'data:text/html,hi'), false);
  assert.equal(security.shouldAllowInAppNavigation(current, 'file:///etc/passwd'), false);
});

test('external URL policy allows https only', () => {
  assert.equal(security.isAllowedExternalHttpsUrl('https://example.com/docs'), true);
  assert.equal(security.isAllowedExternalHttpsUrl('http://example.com'), false);
  assert.equal(security.isAllowedExternalHttpsUrl('javascript:alert(1)'), false);
  assert.equal(security.isAllowedExternalHttpsUrl('file:///tmp/x'), false);
  assert.equal(security.isAllowedExternalHttpsUrl('https://user:pass@example.com'), false);
});

test('OAuth start URL allowlist is limited to API /auth/google', () => {
  const api = 'https://ghost-protocol-production-f7ef.up.railway.app';
  assert.equal(
    security.isAllowedOAuthStartUrl(`${api}/auth/google?platform=electron`, api),
    true
  );
  assert.equal(
    security.isAllowedOAuthStartUrl('http://127.0.0.1:3000/auth/google', 'http://127.0.0.1:3000'),
    true
  );
  assert.equal(security.isAllowedOAuthStartUrl(`${api}/auth/login`, api), false);
  assert.equal(
    security.isAllowedOAuthStartUrl('https://accounts.google.com/o/oauth2/v2/auth', api),
    false
  );
  assert.equal(
    security.isAllowedOAuthStartUrl('https://evil.example/auth/google', api),
    false
  );
});

test('malformed ghost-protocol callbacks are rejected', () => {
  assert.equal(security.parseAuthCallbackUrl('ghost-protocol://auth/callback').ok, true);
  assert.equal(security.parseAuthCallbackUrl('ghost-protocol://auth/callback?code=x').ok, true);
  assert.equal(
    security.parseAuthCallbackUrl('ghost-protocol://auth/callback#google_exchange=abc').ok,
    true
  );
  assert.equal(
    security.parseAuthCallbackUrl('ghost-protocol://auth/callback#google_exchange=abc').url,
    'ghost-protocol://auth/callback#google_exchange=abc'
  );
  assert.equal(security.parseAuthCallbackUrl('ghost-protocol://auth/other').ok, false);
  assert.equal(security.parseAuthCallbackUrl('https://auth/callback').ok, false);
  assert.equal(security.parseAuthCallbackUrl('ghost-protocol://evil/callback').ok, false);
  assert.equal(security.parseAuthCallbackUrl('not a url').ok, false);
  assert.equal(
    security.parseAuthCallbackUrl(`ghost-protocol://auth/callback?${'a'.repeat(3000)}`).ok,
    false
  );
});

test('CSP has no unsafe-eval and connect-src is scoped', () => {
  const csp = security.buildContentSecurityPolicy('https://api.example.com');
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /connect-src[^;]*https:\/\/api\.example\.com/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
});

test('session errors do not embed tokens or paths', () => {
  const err = security.createSessionError(security.SESSION_STORAGE_FAILED);
  assert.equal(err.message, security.SESSION_STORAGE_FAILED);
  assert.doesNotMatch(err.message, /token/i);
  assert.doesNotMatch(err.message, /\//);
});
