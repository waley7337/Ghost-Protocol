import { api, ApiError } from './api.js';

const isElectron = Boolean(window.ghostDesktop);
const REDIRECT_URL = isElectron
  ? 'ghost-protocol://auth/callback'
  : `${window.location.origin}${window.location.pathname}`;

let profile = null;
let syncTimer;
let syncEnabled = false;

const authMarkup = `<div id="auth-gate"><div class="auth-card"><div class="auth-brand">👻 GHOST PROTOCOL</div><div class="auth-sub">// OPERATIVE AUTHENTICATION //</div><div id="auth-login"><button class="auth-btn auth-btn-google auth-hidden" id="auth-google" type="button" disabled aria-hidden="true">CONTINUE WITH GOOGLE</button><div class="auth-divider auth-hidden" id="auth-google-divider" aria-hidden="true">OR</div><input class="auth-input" id="auth-email" type="email" autocomplete="email" placeholder="OPERATIVE EMAIL"><input class="auth-input" id="auth-password" type="password" autocomplete="current-password" placeholder="PASSWORD"><button class="auth-btn" id="auth-submit">SIGN IN</button><div class="auth-links"><button class="auth-link auth-hidden" id="auth-forgot" type="button" disabled aria-hidden="true">Forgot password?</button><button class="auth-link" id="auth-mode">Create account</button></div></div><div id="auth-reset" class="auth-hidden"><input class="auth-input" id="auth-new-password" type="password" autocomplete="new-password" placeholder="NEW PASSWORD"><button class="auth-btn" id="auth-reset-submit">UPDATE PASSWORD</button></div><div class="auth-message" id="auth-message"></div></div></div><div id="auth-profile"><button class="profile-trigger" id="profile-trigger">● OPERATIVE</button><div class="profile-panel auth-hidden" id="profile-panel"><div class="profile-head"><img class="profile-avatar" id="profile-avatar" alt=""><div><div class="profile-name" id="profile-name"></div><div class="profile-email" id="profile-email"></div></div></div><div class="profile-stats" id="profile-stats"></div><button class="auth-btn" id="auth-logout">LOGOUT</button></div></div>`;
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
    not_authenticated: 'Please sign in to continue.'
  };
  if (code && map[code]) return map[code];
  if (error instanceof ApiError && error.message) return error.message;
  return error?.message || 'Authentication failed. Please try again.';
}

function setBusy(busy) {
  document.querySelectorAll('#auth-gate button:not(.auth-hidden),#auth-gate input').forEach((el) => {
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

/**
 * STARTUP SYNC BARRIER:
 * AUTH → LOAD SERVER PROGRESS → HYDRATE/INIT → SYNC ENABLED → then uploads.
 * Events before sync is enabled must NOT overwrite server progress.
 */
async function loadProgressWithBarrier() {
  disableSync();
  try {
    const result = await api.getProgress();
    if (result?.progress) {
      window.GhostProgress?.hydrate(result.progress);
    }
  } catch (error) {
    if (error?.code === 'progress_not_found' || error?.status === 404) {
      const local = window.GhostProgress?.snapshot() || {};
      await api.putProgress(local);
    } else {
      throw error;
    }
  } finally {
    enableSync();
  }
}

async function saveProgress(progress) {
  if (!syncEnabled || !api.isAuthenticated()) return;
  await api.putProgress(progress);
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

// Keep deep-link architecture for a future OAuth phase; do not call Supabase.
if (isElectron && window.ghostDesktop?.onAuthCallback) {
  window.ghostDesktop.onAuthCallback(async () => {
    message('Google sign-in is not available yet.', true);
  });
}

$('auth-google').onclick = () => {
  message('Google sign-in is temporarily unavailable.', true);
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
  disableSync();
  clearTimeout(syncTimer);
  try {
    const result = await api.logout();
    if (!result.serverOk) {
      // Local tokens cleared; server session may remain until expiry/rotation.
      message('Signed out locally. Server logout could not be confirmed.', true);
    }
  } catch {
    await api.clearSession();
  }
  profile = null;
  showGate(true);
  $('profile-panel').classList.add('auth-hidden');
};

window.addEventListener('ghost-progress-changed', (event) => {
  if (!syncEnabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => saveProgress(event.detail).catch(() => {}), 700);
  updateProfile();
});

async function initializeAuthentication() {
  try {
    disableSync();
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

// Preserve protocol constant for future OAuth wiring (unused in Phase 5 email auth).
void REDIRECT_URL;

window.ghostAuthReady = initializeAuthentication();
