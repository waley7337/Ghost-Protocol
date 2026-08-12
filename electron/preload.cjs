'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, frozen desktop bridge.
 * Never exposes Node/fs. Token values are opaque strings only.
 */
contextBridge.exposeInMainWorld(
  'ghostDesktop',
  Object.freeze({
    apiBaseUrl: (() => {
      try {
        return ipcRenderer.sendSync('auth:get-api-base-sync');
      } catch {
        return 'http://127.0.0.1:3000';
      }
    })(),
    beginOAuth: (url) => ipcRenderer.invoke('auth:open-oauth', url),
    onAuthCallback: (callback) => {
      const listener = (_event, url) => callback(url);
      ipcRenderer.on('auth:callback', listener);
      return () => ipcRenderer.removeListener('auth:callback', listener);
    },
    getRefreshToken: () => ipcRenderer.invoke('auth:get-refresh-token'),
    setRefreshToken: (token) => ipcRenderer.invoke('auth:set-refresh-token', token),
    clearRefreshToken: () => ipcRenderer.invoke('auth:clear-refresh-token')
  })
);
