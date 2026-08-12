/**
 * Phase 7 web / platform unit tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectRuntime,
  detectAuthStorageMode,
  describeAuthStorage
} from '../../src/platform.js';
import {
  createApiClient,
  createDefaultTokenStorage,
  resolvePublicApiBaseUrl
} from '../../src/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('detectRuntime distinguishes electron bridge from browser', () => {
  assert.equal(detectRuntime({}), 'browser');
  assert.equal(detectRuntime({ ghostDesktop: { apiBaseUrl: 'http://x' } }), 'electron');
});

test('browser auth storage is memory-only (no localStorage)', async () => {
  assert.equal(detectAuthStorageMode({}), 'memory');
  const desc = describeAuthStorage('memory');
  assert.equal(desc.persistsAcrossRelaunch, false);
  assert.match(desc.notes, /memory/i);

  const storage = createDefaultTokenStorage({});
  assert.equal(storage.mode, 'memory');
  await storage.setRefreshToken('refresh-secret-value');
  assert.equal(await storage.getRefreshToken(), 'refresh-secret-value');

  // Guard: default browser path must not touch Web Storage APIs.
  const apiSrc = fs.readFileSync(path.join(root, 'src/api.js'), 'utf8');
  assert.doesNotMatch(apiSrc, /localStorage\.setItem/);
  assert.doesNotMatch(apiSrc, /sessionStorage\.setItem/);
});

test('electron auth storage uses authSession bridge', async () => {
  const calls = [];
  const ghostDesktop = {
    authSession: {
      async load() {
        calls.push('load');
        return 'stored-refresh';
      },
      async store(token) {
        calls.push(`store:${token}`);
      },
      async clear() {
        calls.push('clear');
      }
    }
  };
  assert.equal(detectAuthStorageMode({ ghostDesktop }), 'electron-safeStorage');
  const storage = createDefaultTokenStorage({ ghostDesktop });
  assert.equal(storage.mode, 'electron-safeStorage');
  assert.equal(await storage.getRefreshToken(), 'stored-refresh');
  await storage.setRefreshToken('next');
  await storage.clearRefreshToken();
  assert.deepEqual(calls, ['load', 'store:next', 'clear']);
});

test('resolvePublicApiBaseUrl prefers desktop then window config', () => {
  assert.equal(
    resolvePublicApiBaseUrl({
      ghostDesktop: { apiBaseUrl: 'https://api.example' },
      GHOST_API_BASE_URL: 'https://other.example'
    }),
    'https://api.example'
  );
  assert.equal(
    resolvePublicApiBaseUrl({ GHOST_API_BASE_URL: 'https://api.example/' }),
    'https://api.example'
  );
  assert.equal(resolvePublicApiBaseUrl({}), 'http://127.0.0.1:3000');
});

test('browser client keeps refresh in memory storage only', async () => {
  let memoryPeek = null;
  const storage = {
    mode: 'memory',
    async getRefreshToken() {
      return memoryPeek;
    },
    async setRefreshToken(token) {
      memoryPeek = token;
    },
    async clearRefreshToken() {
      memoryPeek = null;
    }
  };
  const client = createApiClient({
    baseUrl: 'http://api.test',
    storage,
    fetchImpl: async (url) => {
      if (url.endsWith('/auth/login')) {
        return new Response(
          JSON.stringify({
            accessToken: 'a',
            refreshToken: 'r',
            user: { id: 'u', email: 'a@example.com' }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(url);
    }
  });
  await client.login('a@example.com', 'pw');
  assert.equal(client.getAccessToken(), 'a');
  assert.equal(memoryPeek, 'r');
});

test('index.html loads public config before auth bundle', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const configIdx = html.indexOf('assets/config.js');
  const bundleIdx = html.indexOf('assets/auth.bundle.js');
  assert.ok(configIdx > 0);
  assert.ok(bundleIdx > configIdx);
});

test('vercel.json points at web static output', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.outputDirectory, 'dist/web');
  assert.equal(vercel.buildCommand, 'npm run build:web');
  assert.equal(vercel.framework, null);
  const configHeader = vercel.headers.find((h) => h.source === '/assets/config.js');
  assert.ok(configHeader);
  assert.equal(
    configHeader.headers.find((x) => x.key === 'Cache-Control')?.value,
    'no-store'
  );
});

test('web config and sources contain no server secrets or Supabase runtime', () => {
  const files = [
    'assets/config.js',
    'src/api.js',
    'src/auth.js',
    'src/platform.js',
    'vercel.json'
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(text, /DATABASE_URL\s*=\s*postgresql:\/\/[^:]+:[^@\s]+@/i);
    assert.doesNotMatch(text, /@supabase\/supabase-js/);
    assert.doesNotMatch(text, /lkbdybejiiijocnhwmvm\.supabase\.co/);
    assert.doesNotMatch(text, /sb_publishable_/);
  }
});
