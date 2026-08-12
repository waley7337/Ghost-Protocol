'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');

const isMac = process.platform === 'darwin';
const authScheme = 'ghost-protocol';
const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000';
const MAX_REFRESH_TOKEN_LENGTH = 8192;

let mainWindow;
let pendingAuthCallback;

function resolveApiBaseUrl() {
  const fromEnv = process.env.GHOST_API_BASE_URL || process.env.API_PUBLIC_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim().replace(/\/+$/, '');
  }
  return DEFAULT_API_BASE_URL;
}

const apiBaseUrl = resolveApiBaseUrl();

if (!app.requestSingleInstanceLock()) app.quit();
app.setAsDefaultProtocolClient(authScheme);

function isAuthCallback(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${authScheme}:` && parsed.hostname === 'auth';
  } catch {
    return false;
  }
}

function forwardAuthCallback(url) {
  if (!isAuthCallback(url)) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:callback', url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingAuthCallback = url;
  }
}

app.on('second-instance', (_event, argv) => {
  const callback = argv.find(isAuthCallback);
  if (callback) forwardAuthCallback(callback);
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  forwardAuthCallback(url);
});

function connectSrcAllowlist() {
  const hosts = new Set(["'self'", apiBaseUrl]);
  // Dev convenience aliases when using the default local API.
  if (apiBaseUrl.includes('127.0.0.1') || apiBaseUrl.includes('localhost')) {
    hosts.add('http://127.0.0.1:3000');
    hosts.add('http://localhost:3000');
  }
  return [...hosts].join(' ');
}

function installContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src ${connectSrcAllowlist()}; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'`
        ]
      }
    });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#020804',
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icons', 'png', '512x512.png'),
    title: 'Ghost Protocol',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });
  mainWindow = window;

  window.once('ready-to-show', () => {
    window.show();
    if (pendingAuthCallback) {
      forwardAuthCallback(pendingAuthCallback);
      pendingAuthCallback = undefined;
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  void window.loadFile(path.join(__dirname, '..', 'index.html'));
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  );
}

function sessionFilePath() {
  return path.join(app.getPath('userData'), 'ghost-auth-session.json');
}

/**
 * Persist refresh token in Electron userData via main process.
 * Not OS keychain (no new deps) — Phase 6 may upgrade to keychain.
 * Never log token values.
 */
function readStoredRefreshToken() {
  try {
    const raw = fs.readFileSync(sessionFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.refreshToken === 'string' && parsed.refreshToken) {
      return parsed.refreshToken;
    }
  } catch {
    // Missing or unreadable session file → no session.
  }
  return null;
}

function writeStoredRefreshToken(token) {
  const file = sessionFilePath();
  if (!token) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already absent
    }
    return;
  }
  fs.writeFileSync(file, JSON.stringify({ refreshToken: token }), { mode: 0o600 });
}

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return event.sender === mainWindow.webContents;
}

function validateRefreshTokenInput(token) {
  if (token === null || token === undefined || token === '') return null;
  if (typeof token !== 'string') {
    throw new Error('Invalid refresh token');
  }
  if (token.length > MAX_REFRESH_TOKEN_LENGTH) {
    throw new Error('Refresh token too long');
  }
  return token;
}

app.whenReady().then(() => {
  ipcMain.on('auth:get-api-base-sync', (event) => {
    if (!isTrustedSender(event) && mainWindow && !mainWindow.isDestroyed()) {
      // During preload, sender is the window being created — allow first window.
    }
    event.returnValue = apiBaseUrl;
  });

  ipcMain.handle('auth:get-refresh-token', (event) => {
    if (!isTrustedSender(event)) return null;
    return readStoredRefreshToken();
  });

  ipcMain.handle('auth:set-refresh-token', (event, token) => {
    if (!isTrustedSender(event)) throw new Error('Unauthorized');
    const validated = validateRefreshTokenInput(token);
    writeStoredRefreshToken(validated);
    return true;
  });

  ipcMain.handle('auth:clear-refresh-token', (event) => {
    if (!isTrustedSender(event)) throw new Error('Unauthorized');
    writeStoredRefreshToken(null);
    return true;
  });

  // OAuth deep-link architecture retained for Phase 6; no provider configured yet.
  ipcMain.handle('auth:open-oauth', async (_event, url) => {
    if (typeof url !== 'string') throw new Error('Blocked untrusted authentication URL');
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Blocked untrusted authentication URL');
    }
    if (parsed.protocol !== 'https:') {
      throw new Error('Blocked untrusted authentication URL');
    }
    // No OAuth provider allowlist configured in Phase 5.
    throw new Error('OAuth is not configured');
  });

  installContentSecurityPolicy();
  createMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
