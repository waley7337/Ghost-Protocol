/**
 * Auth readiness helpers (WAL-255).
 *
 * Timeouts (keep boot fail-safe above unlock/init):
 * - Unlock profile/progress (/me/*): 8s — hung sync must not block signed-in UI.
 * - initializeAuthentication overall: 10s — covers exchange/restore hang before unlock.
 * - Boot splash fail-safe: 12s — INITIALIZING must always end; never invent a session.
 */

export const UNLOCK_TIMEOUT_MS = 8000;
export const AUTH_READY_TIMEOUT_MS = 10000;
export const BOOT_AUTH_TIMEOUT_MS = 12000;

/**
 * Reject if `promise` does not settle within `ms`.
 * Does not cancel the underlying work; callers use reject to unblock UI.
 */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.name = 'TimeoutError';
      err.code = 'timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Race auth-ready with a boot fail-safe.
 * On timeout, reports only real isAuthenticated() — never manufactures tokens/session.
 */
export async function raceAuthReadyForBoot(
  authReadyPromise,
  isAuthenticated,
  timeoutMs = BOOT_AUTH_TIMEOUT_MS
) {
  if (authReadyPromise == null) {
    try {
      return typeof isAuthenticated === 'function' ? isAuthenticated() === true : false;
    } catch {
      return false;
    }
  }

  const ready = Promise.resolve(authReadyPromise).then((value) => Boolean(value));
  const failSafe = new Promise((resolve) => {
    setTimeout(() => {
      try {
        resolve(typeof isAuthenticated === 'function' ? isAuthenticated() === true : false);
      } catch {
        resolve(false);
      }
    }, timeoutMs);
  });
  return Promise.race([ready, failSafe]);
}
