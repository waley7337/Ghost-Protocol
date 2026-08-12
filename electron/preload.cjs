'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostDesktop', Object.freeze({
  beginOAuth: (url) => ipcRenderer.invoke('auth:open-oauth', url),
  onAuthCallback: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on('auth:callback', listener);
    return () => ipcRenderer.removeListener('auth:callback', listener);
  }
}));
