/**
 * Runtime platform abstraction (Electron desktop vs browser web).
 * Auth token storage differs by platform — never persist refresh tokens in
 * browser localStorage/sessionStorage for Phase 7.
 */

export function detectRuntime(globalObj = globalThis) {
  if (globalObj && globalObj.ghostDesktop) {
    return 'electron';
  }
  return 'browser';
}

/**
 * @returns {'electron-safeStorage' | 'memory'}
 */
export function detectAuthStorageMode(globalObj = globalThis) {
  const desktop = globalObj?.ghostDesktop;
  const authSession = desktop?.authSession;
  if (
    authSession &&
    typeof authSession.load === 'function' &&
    typeof authSession.store === 'function' &&
    typeof authSession.clear === 'function'
  ) {
    return 'electron-safeStorage';
  }
  return 'memory';
}

/**
 * Honest storage capabilities for docs/tests.
 */
export function describeAuthStorage(mode = detectAuthStorageMode()) {
  if (mode === 'electron-safeStorage') {
    return {
      mode,
      accessToken: 'memory',
      refreshToken: 'electron-main-safeStorage',
      persistsAcrossRelaunch: true,
      notes:
        'Refresh material is stored via the narrow preload authSession bridge; main encrypts with Electron safeStorage when available (PLATFORM-DEPENDENT).'
    };
  }
  return {
    mode: 'memory',
    accessToken: 'memory',
    refreshToken: 'memory',
    persistsAcrossRelaunch: false,
    notes:
      'Browser/web: refresh and access tokens stay in process memory only. Closing the tab ends the session. No localStorage/sessionStorage refresh persistence in Phase 7.'
  };
}
