'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, frozen desktop bridge (Phase 6).
 * Renderer receives opaque session operations only — no Node, filesystem, path, or shell.
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
    authSession: Object.freeze({
      store: (token) => ipcRenderer.invoke('auth-session:store', token),
      load: () => ipcRenderer.invoke('auth-session:load'),
      clear: () => ipcRenderer.invoke('auth-session:clear')
    }),
    beginOAuth: (url) => ipcRenderer.invoke('auth:open-oauth', url),
    onAuthCallback: (callback) => {
      const listener = (_event, url) => {
        if (typeof callback === 'function') callback(url);
      };
      ipcRenderer.on('auth:callback', listener);
      return () => ipcRenderer.removeListener('auth:callback', listener);
    }
  })
);
