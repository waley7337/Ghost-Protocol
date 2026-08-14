/**
 * WAL-255 — OAuth / auth readiness must always settle (no forever INITIALIZING).
 * Pure unit tests for readiness helpers + static lifecycle guards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_READY_TIMEOUT_MS,
  BOOT_AUTH_TIMEOUT_MS,
  UNLOCK_TIMEOUT_MS,
  raceAuthReadyForBoot,
  withTimeout
} from '../../src/auth-readiness.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('readiness timeout constants are ordered unlock < init < boot', () => {
  assert.equal(UNLOCK_TIMEOUT_MS, 8000);
  assert.equal(AUTH_READY_TIMEOUT_MS, 10000);
  assert.equal(BOOT_AUTH_TIMEOUT_MS, 12000);
  assert.ok(UNLOCK_TIMEOUT_MS < AUTH_READY_TIMEOUT_MS);
  assert.ok(AUTH_READY_TIMEOUT_MS < BOOT_AUTH_TIMEOUT_MS);
});

test('withTimeout resolves when promise settles in time', async () => {
  const value = await withTimeout(Promise.resolve('ok'), 50, 'fast');
  assert.equal(value, 'ok');
});

test('withTimeout rejects on hang (does not invent success)', async () => {
  const hung = new Promise(() => {});
  await assert.rejects(
    () => withTimeout(hung, 30, 'hung-op'),
    (err) => {
      assert.equal(err.name, 'TimeoutError');
      assert.equal(err.code, 'timeout');
      assert.match(err.message, /hung-op/);
      return true;
    }
  );
});

test('withTimeout rejects when promise rejects before timeout', async () => {
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('sync-failed')), 200, 'fail'),
    /sync-failed/
  );
});

test('raceAuthReadyForBoot settles true when auth-ready succeeds', async () => {
  const result = await raceAuthReadyForBoot(Promise.resolve(true), () => false, 200);
  assert.equal(result, true);
});

test('raceAuthReadyForBoot settles false on exchange/auth failure', async () => {
  const result = await raceAuthReadyForBoot(Promise.resolve(false), () => false, 200);
  assert.equal(result, false);
});

test('raceAuthReadyForBoot settles false when no session / no ready promise', async () => {
  assert.equal(await raceAuthReadyForBoot(null, () => false, 50), false);
  assert.equal(await raceAuthReadyForBoot(undefined, () => false, 50), false);
});

test('raceAuthReadyForBoot timeout uses real isAuthenticated only', async () => {
  const hung = new Promise(() => {});
  let probes = 0;
  const result = await raceAuthReadyForBoot(
    hung,
    () => {
      probes += 1;
      return false;
    },
    40
  );
  assert.equal(result, false);
  assert.ok(probes >= 1);
});

test('raceAuthReadyForBoot timeout reports true only if real session exists', async () => {
  const hung = new Promise(() => {});
  const result = await raceAuthReadyForBoot(hung, () => true, 40);
  assert.equal(result, true);
});

test('raceAuthReadyForBoot prefers settled auth-ready over later timeout', async () => {
  const result = await raceAuthReadyForBoot(
    Promise.resolve(true),
    () => {
      throw new Error('isAuthenticated must not be required when ready settled');
    },
    500
  );
  assert.equal(result, true);
});

test('simulated fragment exchange → hung profile → unlock timeout settles authenticated', async () => {
  // Mirrors src/auth.js: exchange sets session, unlock wraps profile/progress with withTimeout,
  // catch path still reports authenticated without inventing tokens.
  let session = null;
  const api = {
    async exchangeGoogle() {
      session = { accessToken: 'access', user: { id: 'u1', email: 'a@example.com' } };
    },
    isAuthenticated() {
      return Boolean(session?.accessToken && session?.user);
    },
    getUser() {
      return session?.user || null;
    }
  };

  const hungProfile = new Promise(() => {});
  async function unlockAuthenticatedSession() {
    if (!api.getUser()) return false;
    try {
      await withTimeout(hungProfile, 40, 'profile/progress unlock');
      return true;
    } catch {
      return api.isAuthenticated();
    }
  }

  async function completeGoogleExchange() {
    await api.exchangeGoogle('exchange-code');
    // Fragment would be cleared here (clearGoogleQueryParams) after successful exchange.
    return unlockAuthenticatedSession();
  }

  async function initializeAuthentication() {
    return withTimeout(
      (async () => {
        await completeGoogleExchange();
        return api.isAuthenticated();
      })(),
      200,
      'initializeAuthentication'
    );
  }

  const ready = initializeAuthentication();
  const boot = raceAuthReadyForBoot(ready, () => api.isAuthenticated(), 300);
  const [authReady, bootResult] = await Promise.all([ready, boot]);

  assert.equal(authReady, true);
  assert.equal(bootResult, true);
  assert.equal(api.isAuthenticated(), true);
});

test('simulated exchange failure settles auth-ready false (no hang)', async () => {
  async function initializeAuthentication() {
    try {
      await withTimeout(
        (async () => {
          throw Object.assign(new Error('bad code'), { code: 'invalid_exchange_code' });
        })(),
        200,
        'initializeAuthentication'
      );
    } catch (error) {
      if (error?.name === 'TimeoutError') return false;
      return false;
    }
    return false;
  }

  const result = await raceAuthReadyForBoot(initializeAuthentication(), () => false, 300);
  assert.equal(result, false);
});

test('src/auth.js wires unlock + init timeouts and boot helper', () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.match(auth, /from '\.\/auth-readiness\.js'/);
  assert.match(auth, /withTimeout\s*\(/);
  assert.match(auth, /UNLOCK_TIMEOUT_MS/);
  assert.match(auth, /AUTH_READY_TIMEOUT_MS/);
  assert.match(auth, /BOOT_AUTH_TIMEOUT_MS/);
  assert.match(auth, /window\.ghostAuthIsAuthenticated\s*=/);
  assert.match(auth, /window\.ghostResolveAuthForBoot\s*=/);
  assert.match(auth, /window\.ghostAuthReady\s*=\s*initializeAuthentication\s*\(\s*\)/);
  assert.match(auth, /error\?\.name === 'TimeoutError'/);
  // Timeout path returns real auth state; clearSession is only for non-timeout failures.
  assert.match(
    auth,
    /if \(error\?\.name === 'TimeoutError'\) \{\s*return api\.isAuthenticated\(\);\s*\}/
  );
  assert.match(auth, /await api\.clearSession\(\);/);
});

test('index.html boot uses resolve helper / fail-safe (never bare await-only hang)', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /ghostResolveAuthForBoot|ghostAuthIsAuthenticated/);
  assert.match(html, /12000/);
  assert.match(html, /finishGhostStartup\(authenticated===true\)/);
  // Must not only await ghostAuthReady without a timeout path.
  assert.doesNotMatch(
    html,
    /const authenticated=await window\.ghostAuthReady;\s*window\.finishGhostStartup\(authenticated\);/
  );
});

test('auth readiness does not weaken fragment delivery or Google exchange APIs', () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.match(auth, /clearGoogleQueryParams/);
  assert.match(auth, /exchangeGoogle/);
  assert.match(auth, /google_exchange/);
  assert.match(auth, /readGoogleCallbackParams/);
  assert.match(auth, /url\.hash\s*=\s*''/);
});
