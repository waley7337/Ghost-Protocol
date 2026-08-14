import { api, ApiError } from './api.js';

const isElectron = Boolean(window.ghostDesktop);
const REDIRECT_URL = isElectron
  ? 'ghost-protocol://auth/callback'
  : `${window.location.origin}${window.location.pathname || '/'}`;

let profile = null;
let syncTimer;
let syncEnabled = false;
/** True after successful server hydrate or first-time progress bootstrap PUT. */
let progressReady = false;
/** Local progress diverged from last successful server save (or pending debounce). */
let progressDirty = false;
/** Prevents visibilitychange + pagehide from starting two unload PUTs for the same hide. */
let unloadFlushStarted = false;

const authMarkup = `<div id="auth-gate"><div class="auth-card"><div class="auth-brand">👻 GHOST PROTOCOL</div><div class="auth-sub">// OPERATIVE AUTHENTICATION //</div><div id="auth-login"><button class="auth-btn auth-btn-google" id="auth-google">CONTINUE WITH GOOGLE</button><div class="auth-divider">OR</div><input class="auth-input" id="auth-email" type="email" autocomplete="email" placeholder="OPERATIVE EMAIL"><input class="auth-input" id="auth-password" type="password" autocomplete="current-password" placeholder="PASSWORD"><button class="auth-btn" id="auth-submit">SIGN IN</button><div class="auth-links"><button class="auth-link" id="auth-forgot">Forgot password?</button><button class="auth-link" id="auth-mode">Create account</button></div></div><div id="auth-reset" class="auth-hidden"><input class="auth-input" id="auth-new-password" type="password" autocomplete="new-password" placeholder="NEW PASSWORD"><button class="auth-btn" id="auth-reset-submit">UPDATE PASSWORD</button></div><div class="auth-message" id="auth-message"></div></div></div><div id="auth-profile"><button class="profile-trigger" id="profile-trigger">● OPERATIVE</button><div class="profile-panel auth-hidden" id="profile-panel"><div class="profile-head"><img class="profile-avatar" id="profile-avatar" alt=""><div><div class="profile-name" id="profile-name"></div><div class="profile-email" id="profile-email"></div></div></div><div class="profile-stats" id="profile-stats"></div><button class="auth-btn" id="auth-logout">LOGOUT</button></div></div>`;
document.body.insertAdjacentHTML('beforeend', authMarkup);
const $ = (id) => document.getElementById(id);

function message(text = '', error = false) {
  $('auth-message').textContent = text;
  $('auth-message').classList.toggle('error', error);
}

function friendly(error) {
  const code = error?.code;
  const map = {
    invalid_credentials: 'Incorrect email or password.',
    email_unavailable: 'An account already exists for this email.',
    invalid_email: 'Enter a valid email address.',
    invalid_password: 'Password does not meet requirements.',
    weak_password: 'Password does not meet requirements.',
    no_refresh_token: 'Session expired. Please sign in again.',
    unauthorized: 'Session expired. Please sign in again.',
    not_authenticated: 'Please sign in to continue.',
    google_not_configured: 'Google sign-in is not configured on the server.',
    google_cancelled: 'Google sign-in was cancelled.',
    google_rejected: 'Google sign-in was rejected.',
    google_email_unverified: 'Your Google email must be verified to continue.',
    google_email_missing: 'Google did not provide an email address.',
    account_conflict:
      'An account already exists for this email. Sign in using your existing method.',
    google_email_conflict: 'This Google email conflicts with an existing account.',
    google_account_mismatch:
      'An account already exists for this email. Sign in using your existing method.',
    google_account_conflict: 'Unable to create an account for this Google identity.',
    google_already_linked: 'This Google account is already linked.',
    invalid_oauth_state: 'Google sign-in expired. Please try again.',
    invalid_exchange_code: 'Google sign-in expired. Please try again.',
    google_token_exchange_failed: 'Google authorization failed. Please try again.',
    google_identity_invalid: 'Google identity could not be verified.',
    invalid_return_to: 'Google sign-in return URL is not allowed.',
    api_base_unconfigured: 'API is not configured. Please reload or contact support.',
    SESSION_UNAVAILABLE: 'Secure session storage is unavailable. Please sign in again.',
    SESSION_STORAGE_FAILED: 'Unable to store your session securely. Please try again.'
  };
  if (code && map[code]) return map[code];
  if (error instanceof ApiError && error.message) return error.message;
  return error?.message || 'Authentication failed. Please try again.';
}

function setBusy(busy) {
  document.querySelectorAll('#auth-gate button,#auth-gate input').forEach((el) => {
    el.disabled = busy;
  });
}

function showGate(show) {
  $('auth-gate').style.display = show ? 'flex' : 'none';
  $('auth-profile').style.display = show ? 'none' : 'block';
}

showGate(true);

function disableSync() {
  syncEnabled = false;
}

function enableSync() {
  syncEnabled = true;
}

function clearGoogleQueryParams() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of [
      'google_exchange',
      'google_error',
      'google_error_message',
      'code',
      'state',
      'error',
      'error_description'
    ]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // ignore history cleanup failures
  }
}

async function ensureProfileForUser(user) {
  const existing = await api.getProfile();
  profile = existing;
  const defaultName = user?.email?.split('@')[0] || 'Operative';
  if (!existing?.name || existing.name === 'Operative') {
    try {
      profile = await api.putProfile({ name: defaultName });
    } catch {
      profile = existing;
    }
  }
  return profile;
}

function isPlainProgressObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Client-side progress schema gate before any PUT.
 * Rejects null/undefined/arrays/{}/malformed shells — not a weak JSON.stringify !== '{}' check.
 * Full GhostProgress field set is required so uninitialized snapshots cannot upload.
 */
function isValidProgressSnapshot(progress) {
  if (!isPlainProgressObject(progress)) return false;
  if (Object.keys(progress).length === 0) return false;
  if (typeof progress.xp !== 'number' || !Number.isFinite(progress.xp)) return false;
  if (!Array.isArray(progress.solved)) return false;
  if (typeof progress.streak !== 'number' || !Number.isFinite(progress.streak)) return false;
  if (!(progress.lastDay === null || typeof progress.lastDay === 'string')) return false;
  if (!isPlainProgressObject(progress.bestTimes)) return false;
  if (!isPlainProgressObject(progress.notes)) return false;
  if (!isPlainProgressObject(progress.quizScores)) return false;
  if (!Array.isArray(progress.achievements)) return false;
  if (!Array.isArray(progress.unlocks)) return false;
  if (!isPlainProgressObject(progress.preferences)) return false;
  if (!isPlainProgressObject(progress.settings)) return false;
  return true;
}

function markProgressClean() {
  progressDirty = false;
}

function markProgressDirty() {
  progressDirty = true;
}

function needsProgressFlush() {
  return progressDirty || Boolean(syncTimer);
}

/**
 * Drop any prior-account / anonymous local progress before server hydrate.
 * Auth-gated product: never carry localStorage progress across identities.
 */
function resetLocalProgressForNewSession() {
  if (typeof window.GhostProgress?.reset === 'function') {
    window.GhostProgress.reset();
  }
  progressReady = false;
  markProgressClean();
}

function canonicalEmptyProgress() {
  if (typeof window.GhostProgress?.emptySnapshot === 'function') {
    return window.GhostProgress.emptySnapshot();
  }
  return {
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
}

/**
 * STARTUP SYNC BARRIER:
 * AUTH → RESET LOCAL → LOAD SERVER PROGRESS → HYDRATE/INIT → SYNC ENABLED → then uploads.
 * Events before sync is enabled must NOT overwrite server progress.
 *
 * LWW honesty (Phase 9 / WAL-251): concurrent edits from two active clients remain
 * full-snapshot last-write-wins. WAL-202 only stops unload/hydration from writing a
 * clean snapshot — it does not add optimistic concurrency.
 *
 * Cross-account isolation (Phase 9): always reset local progress before hydrate.
 * On progress_not_found, bootstrap canonical empty progress only — never prior-user local ST.
 */
async function loadProgressWithBarrier() {
  disableSync();
  resetLocalProgressForNewSession();
  try {
    const result = await api.getProgress();
    if (result?.progress) {
      window.GhostProgress?.hydrate(result.progress);
      // Hydrated DOM/state population is not a user edit — stay clean, do not echo PUT.
      progressReady = true;
      markProgressClean();
    }
  } catch (error) {
    if (error?.code === 'progress_not_found' || error?.status === 404) {
      const empty = canonicalEmptyProgress();
      if (!isValidProgressSnapshot(empty)) {
        throw error;
      }
      await api.putProgress(empty);
      window.GhostProgress?.hydrate(empty);
      progressReady = true;
      markProgressClean();
    } else {
      throw error;
    }
  } finally {
    enableSync();
  }
}

async function saveProgress(progress) {
  if (!syncEnabled || !api.isAuthenticated() || !progressReady) return;
  if (!isValidProgressSnapshot(progress)) return;
  await api.putProgress(progress);
}

/**
 * Pull open mission notes into ST, then PUT full progress only when dirty/pending.
 * Logout / pagehide previously cleared the debounce timer and skipped the pending
 * upload, so notes that only lived locally were wiped on the next hydrate.
 *
 * Returns true when there was nothing to flush, or a PUT succeeded.
 * Returns false when a required flush could not be completed safely.
 *
 * Unload must never write a clean or hydration-derived snapshot (LWW risk reduction only;
 * see WAL-251 for real concurrency protection).
 */
async function flushProgressToServer({ keepalive = false } = {}) {
  const hadPending = Boolean(syncTimer);
  clearTimeout(syncTimer);
  syncTimer = null;

  if (!syncEnabled || !api.isAuthenticated()) return false;
  if (!progressDirty && !hadPending) return true;

  try {
    if (typeof window.captureNoteFromDom === 'function') {
      window.captureNoteFromDom();
    }
  } catch {
    // DOM may be mid-teardown
  }

  if (!progressReady) return false;
  const progress = window.GhostProgress?.snapshot();
  if (!isValidProgressSnapshot(progress)) return false;

  await api.putProgress(progress, { keepalive });
  markProgressClean();
  return true;
}

function updateProfile() {
  if (!api.isAuthenticated()) return;
  const u = api.getUser();
  const state = window.GhostProgress?.snapshot() || {};
  const ranks = [
    'CIVILIAN',
    'RECRUIT',
    'SCRIPT KIDDIE',
    'PACKET SNIFFER',
    'PAYLOAD CRAFTER',
    'DESYNC DEMON',
    'HTTP GHOST',
    'SHADOW OPERATIVE',
    'GHOST PROTOCOL'
  ];
  const cuts = [0, 100, 300, 700, 1200, 1800, 2600, 3500, 5000];
  let rank = ranks[0];
  cuts.forEach((x, i) => {
    if ((state.xp || 0) >= x) rank = ranks[i];
  });
  const displayName = profile?.name || u?.email?.split('@')[0] || 'Operative';
  $('profile-name').textContent = displayName;
  $('profile-email').textContent = u?.email || '';
  $('profile-avatar').src = profile?.avatarUrl || 'assets/icons/png/64x64.png';
  $('profile-stats').textContent = `RANK: ${rank} · LEVEL: ${cuts.indexOf(cuts.filter((x) => x <= (state.xp || 0)).at(-1)) + 1} · XP: ${state.xp || 0}`;
}

async function unlockAuthenticatedSession({ startApp = false } = {}) {
  const user = api.getUser();
  if (!user) {
    showGate(true);
    return false;
  }
  try {
    await ensureProfileForUser(user);
    await loadProgressWithBarrier();
    updateProfile();
    showGate(false);
    message();
    if (startApp && window.ghostSplashComplete) window.startGhostProtocol();
    return true;
  } catch (error) {
    // Authenticated but sync failed — still unlock; local progress remains.
    enableSync();
    updateProfile();
    showGate(false);
    message('Signed in, but progress sync is unavailable.', true);
    if (startApp && window.ghostSplashComplete) window.startGhostProtocol();
    return true;
  }
}

async function completeGoogleExchange(exchangeCode, { startApp = true } = {}) {
  setBusy(true);
  message();
  disableSync();
  try {
    await api.exchangeGoogle(exchangeCode);
    clearGoogleQueryParams();
    await unlockAuthenticatedSession({ startApp });
  } catch (error) {
    disableSync();
    clearGoogleQueryParams();
    showGate(true);
    message(friendly(error), true);
  } finally {
    setBusy(false);
  }
}

function readGoogleCallbackFromLocation(search = window.location.search) {
  const params = new URLSearchParams(search || '');
  return {
    exchangeCode: params.get('google_exchange'),
    errorCode: params.get('google_error'),
    errorMessage: params.get('google_error_message')
  };
}

async function handleGoogleCallbackPayload({ exchangeCode, errorCode, errorMessage, startApp = true }) {
  if (errorCode) {
    clearGoogleQueryParams();
    showGate(true);
    message(friendly({ code: errorCode, message: errorMessage }), true);
    return true;
  }
  if (exchangeCode) {
    await completeGoogleExchange(exchangeCode, { startApp });
    return true;
  }
  return false;
}

if (isElectron && window.ghostDesktop?.onAuthCallback) {
  window.ghostDesktop.onAuthCallback(async (callbackUrl) => {
    try {
      const parsed = new URL(callbackUrl);
      await handleGoogleCallbackPayload({
        exchangeCode: parsed.searchParams.get('google_exchange'),
        errorCode: parsed.searchParams.get('google_error'),
        errorMessage: parsed.searchParams.get('google_error_message'),
        startApp: true
      });
    } catch {
      message('Google sign-in callback was invalid.', true);
    }
  });
}

$('auth-google').onclick = async () => {
  try {
    setBusy(true);
    message();
    if (isElectron && window.ghostDesktop?.beginOAuth) {
      const url = api.buildGoogleStartUrl({ platform: 'electron' });
      await window.ghostDesktop.beginOAuth(url);
      message('Complete Google sign-in in your browser…');
      return;
    }
    const url = api.buildGoogleStartUrl({
      returnTo: REDIRECT_URL
    });
    window.location.assign(url);
  } catch (error) {
    message(friendly(error), true);
  } finally {
    setBusy(false);
  }
};

let signUp = false;
$('auth-mode').onclick = () => {
  signUp = !signUp;
  $('auth-submit').textContent = signUp ? 'CREATE ACCOUNT' : 'SIGN IN';
  $('auth-mode').textContent = signUp ? 'Back to sign in' : 'Create account';
  message();
};

$('auth-submit').onclick = async () => {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  try {
    setBusy(true);
    message();
    disableSync();
    if (signUp) {
      await api.register(email, password);
    } else {
      await api.login(email, password);
    }
    await unlockAuthenticatedSession({ startApp: true });
  } catch (error) {
    disableSync();
    message(friendly(error), true);
  } finally {
    setBusy(false);
  }
};

$('auth-forgot').onclick = () => {
  message('Password reset is temporarily unavailable.', true);
};

$('auth-reset-submit').onclick = () => {
  message('Password reset is temporarily unavailable.', true);
};

$('profile-trigger').onclick = () => $('profile-panel').classList.toggle('auth-hidden');

$('auth-logout').onclick = async () => {
  // One final valid flush while still authenticated — only if dirty/pending.
  let flushOk = true;
  const flushAttempted = api.isAuthenticated() && syncEnabled && needsProgressFlush();
  if (flushAttempted) {
    try {
      flushOk = await flushProgressToServer();
    } catch {
      flushOk = false;
    }
  }
  disableSync();
  clearTimeout(syncTimer);
  syncTimer = null;
  progressReady = false;
  markProgressClean();
  try {
    const result = await api.logout();
    if (!result.serverOk) {
      // Local tokens cleared; server session may remain until expiry/rotation.
      message('Signed out locally. Server logout could not be confirmed.', true);
    } else if (flushAttempted && !flushOk) {
      message('Signed out. Progress sync may be incomplete — notes might not be saved.', true);
    }
  } catch {
    await api.clearSession();
    if (flushAttempted && !flushOk) {
      message('Signed out locally. Progress sync may be incomplete — notes might not be saved.', true);
    }
  }
  profile = null;
  resetLocalProgressForNewSession();
  showGate(true);
  $('profile-panel').classList.add('auth-hidden');
};

window.addEventListener('ghost-progress-changed', () => {
  if (!syncEnabled) return;
  markProgressDirty();
  clearTimeout(syncTimer);
  // Always snapshot at flush time so notes typed after the event are included.
  // Schema gate rejects {} / malformed — never PUT an empty replace body.
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const progress = window.GhostProgress?.snapshot();
    if (!isValidProgressSnapshot(progress)) return;
    saveProgress(progress)
      .then(() => {
        markProgressClean();
      })
      .catch(() => {
        // Stay dirty so logout/unload can retry.
      });
  }, 700);
  updateProfile();
});

// Electron quit / tab close: flush only when dirty/pending (never clean hydrate echo).
function flushOnUnload() {
  if (!api.isAuthenticated() || !syncEnabled) return;
  if (!needsProgressFlush()) return;
  if (unloadFlushStarted) return;
  unloadFlushStarted = true;
  void flushProgressToServer({ keepalive: true }).catch(() => {
    // Allow pagehide to retry if visibilitychange flush failed.
    unloadFlushStarted = false;
  });
}
window.addEventListener('pagehide', flushOnUnload);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushOnUnload();
  } else {
    unloadFlushStarted = false;
  }
});

async function initializeAuthentication() {
  try {
    disableSync();
    const callback = readGoogleCallbackFromLocation();
    if (callback.exchangeCode || callback.errorCode) {
      await handleGoogleCallbackPayload({ ...callback, startApp: true });
      return api.isAuthenticated();
    }

    const user = await api.restoreSession();
    if (!user) {
      showGate(true);
      return false;
    }
    await unlockAuthenticatedSession({ startApp: false });
    return api.isAuthenticated();
  } catch {
    disableSync();
    await api.clearSession();
    showGate(true);
    message('Unable to restore your session. Check your connection and sign in again.', true);
    return false;
  }
}

window.ghostAuthReady = initializeAuthentication();
