'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, ipcMain, session, shell, safeStorage } = require('electron');
const security = require('./security.cjs');

const isMac = process.platform === 'darwin';
const isSmokeTest = process.env.GHOST_SMOKE_TEST === '1';

let mainWindow;
let pendingAuthCallback;
let credentialStore;
let apiBaseUrl;

function resolveStartupApiBaseUrl() {
  const isPackaged = app.isPackaged;
  return security.resolveApiBaseUrlFromEnv(process.env, {
    isPackaged,
    fallback: isPackaged
      ? 'https://ghost-protocol-production-f7ef.up.railway.app'
      : 'http://127.0.0.1:3000'
  });
}

if (isSmokeTest) {
  // Isolate from any already-running installed Ghost Protocol instance.
  app.setName('ghost-protocol-smoke');
  app.setPath('userData', path.join(app.getPath('temp'), 'ghost-protocol-smoke'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(isSmokeTest ? 2 : 0);
}

try {
  apiBaseUrl = resolveStartupApiBaseUrl();
} catch {
  console.error('Ghost Protocol refused to start: invalid or insecure API base URL.');
  app.exit(1);
}

app.setAsDefaultProtocolClient(security.AUTH_SCHEME);

function forwardAuthCallback(url) {
  const parsed = security.parseAuthCallbackUrl(url);
  if (!parsed.ok) return;
  // Forward only the validated callback URL string — never treat as authenticated.
  const safeUrl = parsed.url;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:callback', safeUrl);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingAuthCallback = safeUrl;
  }
}

app.on('second-instance', (_event, argv) => {
  const callback = argv.find((entry) => security.isAuthCallback(entry));
  if (callback) forwardAuthCallback(callback);
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  forwardAuthCallback(url);
});

function installContentSecurityPolicy() {
  const policy = security.buildContentSecurityPolicy(apiBaseUrl);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
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
    show: !isSmokeTest,
    icon: path.join(__dirname, '..', 'assets', 'icons', 'png', '512x512.png'),
    title: 'Ghost Protocol',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      ...security.SECURE_WEB_PREFERENCES,
      devTools: !app.isPackaged
    }
  });
  mainWindow = window;

  window.once('ready-to-show', () => {
    if (!isSmokeTest) window.show();
    if (pendingAuthCallback) {
      forwardAuthCallback(pendingAuthCallback);
      pendingAuthCallback = undefined;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (security.isAllowedExternalHttpsUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!security.shouldAllowInAppNavigation(window.webContents.getURL(), url)) {
      event.preventDefault();
    }
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

function isTrustedSender(event) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return event.sender === mainWindow.webContents;
}

function toIpcError(error) {
  const code =
    error && typeof error.code === 'string' && error.code.startsWith('SESSION_')
      ? error.code
      : security.SESSION_STORAGE_FAILED;
  return security.createSessionError(code);
}

app.whenReady().then(() => {
  credentialStore = security.createCredentialStore({
    userDataPath: app.getPath('userData'),
    fs,
    safeStorage
  });

  ipcMain.on('auth:get-api-base-sync', (event) => {
    event.returnValue = apiBaseUrl;
  });

  ipcMain.handle('auth-session:store', (event, token) => {
    if (!isTrustedSender(event)) throw security.createSessionError(security.SESSION_STORAGE_FAILED);
    try {
      return credentialStore.store(token);
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('auth-session:load', (event) => {
    if (!isTrustedSender(event)) throw security.createSessionError(security.SESSION_UNAVAILABLE);
    try {
      return credentialStore.load();
    } catch (error) {
      throw toIpcError(error);
    }
  });

  ipcMain.handle('auth-session:clear', (event) => {
    if (!isTrustedSender(event)) throw security.createSessionError(security.SESSION_STORAGE_FAILED);
    try {
      return credentialStore.clear();
    } catch (error) {
      throw toIpcError(error);
    }
  });

  // Google OAuth: open only the API /auth/google start URL in the system browser.
  ipcMain.handle('auth:open-oauth', async (event, url) => {
    if (!isTrustedSender(event)) throw new Error('Unauthorized');
    if (!security.isAllowedOAuthStartUrl(url, apiBaseUrl)) {
      throw new Error('Blocked untrusted authentication URL');
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  installContentSecurityPolicy();
  createMenu();
  createWindow();

  if (isSmokeTest) {
    // Startup smoke: confirm main process + BrowserWindow path, then exit.
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'ghost-smoke-ok'), 'ok');
    } catch {
      // ignore marker write failures; exit code still indicates process health
    }
    console.log('GHOST_SMOKE_OK');
    setTimeout(() => app.quit(), 750);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (security.isAllowedExternalHttpsUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!security.shouldAllowInAppNavigation(contents.getURL(), url)) {
      event.preventDefault();
    }
  });
});
