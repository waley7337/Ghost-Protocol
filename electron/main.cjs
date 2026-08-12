'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, ipcMain, session, shell } = require('electron');

const isMac = process.platform === 'darwin';
const authScheme = 'ghost-protocol';
let mainWindow;
let pendingAuthCallback;

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

function installContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://lkbdybejiiijocnhwmvm.supabase.co wss://lkbdybejiiijocnhwmvm.supabase.co; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]));
}

app.whenReady().then(() => {
  ipcMain.handle('auth:open-oauth', async (_event, url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'lkbdybejiiijocnhwmvm.supabase.co') {
      throw new Error('Blocked untrusted authentication URL');
    }
    await shell.openExternal(url);
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
