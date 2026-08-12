/**
 * Ghost Protocol API client (Phase 5–7).
 * Public config only — never ships DATABASE_URL or server secrets.
 *
 * Access tokens: in-memory only (not persisted).
 * Refresh tokens:
 *   - Electron: main-process authSession bridge (safeStorage-encrypted at rest when available)
 *   - Browser/web: memory-only (no localStorage / sessionStorage persistence)
 */

import { detectAuthStorageMode, detectRuntime } from './platform.js';

/** Local/Electron default. Production web builds redefine via esbuild to "". */
const DEFAULT_API_BASE_URL =
  typeof __GHOST_WEB_API_FALLBACK__ === 'string' ? __GHOST_WEB_API_FALLBACK__ : 'http://127.0.0.1:3000';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'api_error', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function resolveApiBaseUrl({
  explicit,
  desktopBase,
  globalBase,
  envBase,
  fallback = DEFAULT_API_BASE_URL
} = {}) {
  const candidates = [explicit, desktopBase, globalBase, envBase, fallback];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replace(/\/+$/, '');
    }
  }
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim().replace(/\/+$/, '');
  }
  throw new ApiError('API base URL is not configured', {
    status: 0,
    code: 'api_base_unconfigured'
  });
}

/**
 * Public client-side API URL resolution (browser + Electron renderer).
 * Never reads DATABASE_URL / token secrets (those are server-only).
 */
export function resolvePublicApiBaseUrl(globalObj = globalThis) {
  return resolveApiBaseUrl({
    desktopBase: globalObj?.ghostDesktop?.apiBaseUrl,
    globalBase: globalObj?.GHOST_API_BASE_URL
  });
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  const json = safeJsonParse(text);
  return { text, json };
}

function errorFromResponse(status, json, fallbackMessage) {
  const message =
    (json && typeof json.message === 'string' && json.message) ||
    (json && typeof json.error === 'string' && json.error) ||
    fallbackMessage;
  const code =
    (json && typeof json.error === 'string' && json.error) ||
    (json && typeof json.code === 'string' && json.code) ||
    'http_error';
  return new ApiError(message, { status, code, details: json });
}

/**
 * Create an API client. Inject fetch/storage for unit tests.
 */
export function createApiClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
  const getBaseUrl =
    options.getBaseUrl ||
    (() =>
      resolveApiBaseUrl({
        explicit: options.baseUrl,
        desktopBase: globalThis.ghostDesktop?.apiBaseUrl,
        globalBase: globalThis.GHOST_API_BASE_URL
      }));

  const storage = options.storage || createDefaultTokenStorage(globalThis);

  let accessToken = null;
  let refreshToken = null;
  let user = null;
  let refreshInFlight = null;

  function getAccessToken() {
    return accessToken;
  }

  function getRefreshToken() {
    return refreshToken;
  }

  function getUser() {
    return user;
  }

  function isAuthenticated() {
    return Boolean(accessToken && user);
  }

  async function setSession({
    accessToken: nextAccess,
    refreshToken: nextRefresh,
    user: nextUser
  } = {}) {
    accessToken = typeof nextAccess === 'string' && nextAccess ? nextAccess : null;
    refreshToken = typeof nextRefresh === 'string' && nextRefresh ? nextRefresh : null;
    if (nextUser !== undefined) {
      user = nextUser || null;
    }
    if (refreshToken) {
      await storage.setRefreshToken(refreshToken);
    } else {
      await storage.clearRefreshToken();
    }
  }

  async function clearSession() {
    accessToken = null;
    refreshToken = null;
    user = null;
    refreshInFlight = null;
    await storage.clearRefreshToken();
  }

  async function hydrateRefreshFromStorage() {
    const stored = await storage.getRefreshToken();
    refreshToken = typeof stored === 'string' && stored ? stored : null;
    return refreshToken;
  }

  async function parseAndThrow(response) {
    const { json } = await readResponseBody(response);
    throw errorFromResponse(response.status, json, `Request failed (${response.status})`);
  }

  async function rawRequest(path, { method = 'GET', body, headers = {}, auth = false } = {}) {
    const url = `${getBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
    const nextHeaders = { Accept: 'application/json', ...headers };
    if (body !== undefined) {
      nextHeaders['Content-Type'] = 'application/json';
    }
    if (auth) {
      if (!accessToken) {
        throw new ApiError('Not authenticated', { status: 401, code: 'not_authenticated' });
      }
      nextHeaders.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetchImpl(url, {
      method,
      headers: nextHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    return response;
  }

  async function refreshSession() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const currentRefresh = refreshToken || (await hydrateRefreshFromStorage());
      if (!currentRefresh) {
        await clearSession();
        throw new ApiError('No refresh token', { status: 401, code: 'no_refresh_token' });
      }

      const response = await rawRequest('/auth/refresh', {
        method: 'POST',
        body: { refreshToken: currentRefresh },
        auth: false
      });

      if (!response.ok) {
        await clearSession();
        const { json } = await readResponseBody(response);
        throw errorFromResponse(response.status, json, 'Session expired. Please sign in again.');
      }

      const { json } = await readResponseBody(response);
      if (!json?.accessToken || !json?.refreshToken) {
        await clearSession();
        throw new ApiError('Invalid refresh response', { status: 500, code: 'invalid_refresh_response' });
      }

      await setSession({
        accessToken: json.accessToken,
        refreshToken: json.refreshToken,
        user: json.user || user
      });
      return json;
    })();

    try {
      return await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  }

  /**
   * Authenticated JSON request with one controlled retry after a successful refresh.
   * Concurrent 401s share a single in-flight refresh promise.
   */
  async function request(path, opts = {}) {
    const { retryOnUnauthorized = true, ...rest } = opts;
    let response = await rawRequest(path, rest);

    if (response.status === 401 && rest.auth && retryOnUnauthorized) {
      await refreshSession();
      response = await rawRequest(path, rest);
    }

    if (!response.ok) {
      await parseAndThrow(response);
    }

    if (response.status === 204) return null;
    const { json } = await readResponseBody(response);
    return json;
  }

  async function register(email, password) {
    const json = await request('/auth/register', {
      method: 'POST',
      body: { email, password },
      auth: false,
      retryOnUnauthorized: false
    });
    await setSession({
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      user: json.user
    });
    return json;
  }

  async function login(email, password) {
    const json = await request('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
      retryOnUnauthorized: false
    });
    await setSession({
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      user: json.user
    });
    return json;
  }

  /**
   * Complete Google OAuth after backend redirects back with a one-time exchange code.
   * Same session model as email/password login.
   */
  async function exchangeGoogle(exchangeCode) {
    const json = await request('/auth/google/exchange', {
      method: 'POST',
      body: { exchangeCode },
      auth: false,
      retryOnUnauthorized: false
    });
    await setSession({
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      user: json.user
    });
    return json;
  }

  function buildGoogleStartUrl({ platform, returnTo } = {}) {
    const base = getBaseUrl();
    const url = new URL(`${base}/auth/google`);
    if (platform) url.searchParams.set('platform', platform);
    if (returnTo) url.searchParams.set('return_to', returnTo);
    return url.toString();
  }

  async function logout() {
    const token = refreshToken || (await hydrateRefreshFromStorage());
    let serverOk = true;
    if (token) {
      try {
        await request('/auth/logout', {
          method: 'POST',
          body: { refreshToken: token },
          auth: false,
          retryOnUnauthorized: false
        });
      } catch {
        // Local cleanup always proceeds; server session may remain until expiry.
        serverOk = false;
      }
    }
    await clearSession();
    return { serverOk };
  }

  async function me() {
    const json = await request('/auth/me', { method: 'GET', auth: true });
    user = json.user || null;
    return json.user;
  }

  async function getProfile() {
    const json = await request('/me/profile', { method: 'GET', auth: true });
    return json.profile;
  }

  async function putProfile(patch) {
    const body = { ...patch };
    delete body.user_id;
    delete body.userId;
    delete body.id;
    const json = await request('/me/profile', { method: 'PUT', body, auth: true });
    return json.profile;
  }

  async function getProgress() {
    return request('/me/progress', { method: 'GET', auth: true });
  }

  async function putProgress(progress) {
    const body = { ...progress };
    delete body.user_id;
    delete body.userId;
    delete body.id;
    return request('/me/progress', { method: 'PUT', body, auth: true });
  }

  /**
   * Restore session: refresh material → access → GET /auth/me.
   * Returns user or null. Does not load profile/progress (caller owns sync barrier).
   */
  async function restoreSession() {
    await hydrateRefreshFromStorage();
    if (!refreshToken) {
      await clearSession();
      return null;
    }
    try {
      await refreshSession();
      const nextUser = await me();
      return nextUser;
    } catch {
      await clearSession();
      return null;
    }
  }

  return {
    DEFAULT_API_BASE_URL,
    getBaseUrl,
    getAccessToken,
    getRefreshToken,
    getUser,
    isAuthenticated,
    setSession,
    clearSession,
    hydrateRefreshFromStorage,
    refreshSession,
    request,
    register,
    login,
    exchangeGoogle,
    buildGoogleStartUrl,
    logout,
    me,
    getProfile,
    putProfile,
    getProgress,
    putProgress,
    restoreSession,
    /** @internal test helper */
    _getRefreshInFlight: () => refreshInFlight
  };
}

function mapSessionBridgeError(error) {
  const code = error?.code || error?.message;
  if (code === 'SESSION_UNAVAILABLE' || code === 'SESSION_STORAGE_FAILED') {
    return new ApiError('Secure session storage unavailable', {
      status: 0,
      code
    });
  }
  return error;
}

function createElectronTokenStorage(authSession) {
  return {
    mode: 'electron-safeStorage',
    async getRefreshToken() {
      try {
        const value = await authSession.load();
        return typeof value === 'string' && value ? value : null;
      } catch (error) {
        throw mapSessionBridgeError(error);
      }
    },
    async setRefreshToken(token) {
      try {
        if (typeof token !== 'string' || !token) {
          await authSession.clear();
          return;
        }
        await authSession.store(token);
      } catch (error) {
        throw mapSessionBridgeError(error);
      }
    },
    async clearRefreshToken() {
      try {
        await authSession.clear();
      } catch (error) {
        throw mapSessionBridgeError(error);
      }
    }
  };
}

function createMemoryTokenStorage() {
  // Browser/web and missing bridge: memory-only — never localStorage/sessionStorage.
  let memoryRefresh = null;
  return {
    mode: 'memory',
    async getRefreshToken() {
      return memoryRefresh;
    },
    async setRefreshToken(token) {
      memoryRefresh = typeof token === 'string' && token ? token : null;
    },
    async clearRefreshToken() {
      memoryRefresh = null;
    }
  };
}

export function createDefaultTokenStorage(globalObj = globalThis) {
  const mode = detectAuthStorageMode(globalObj);
  if (mode === 'electron-safeStorage') {
    return createElectronTokenStorage(globalObj.ghostDesktop.authSession);
  }
  void detectRuntime(globalObj);
  return createMemoryTokenStorage();
}

export const api = createApiClient();
