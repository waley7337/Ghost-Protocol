/**
 * Production web build API URL resolution + artifact guards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveWebBuildApiBaseUrl } from '../../scripts/build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distWeb = path.join(root, 'dist', 'web');

test('resolveWebBuildApiBaseUrl allows localhost only outside production', () => {
  assert.equal(resolveWebBuildApiBaseUrl({}), 'http://127.0.0.1:3000');
  assert.equal(
    resolveWebBuildApiBaseUrl({ GHOST_API_BASE_URL: 'http://127.0.0.1:3000' }),
    'http://127.0.0.1:3000'
  );
  assert.equal(
    resolveWebBuildApiBaseUrl({
      GHOST_API_BASE_URL: 'https://ghost-protocol-production-f7ef.up.railway.app/'
    }),
    'https://ghost-protocol-production-f7ef.up.railway.app'
  );
});

test('production web builds reject missing / localhost / non-HTTPS API URLs', () => {
  assert.throws(
    () => resolveWebBuildApiBaseUrl({ VERCEL: '1' }),
    /require GHOST_API_BASE_URL/
  );
  assert.throws(
    () =>
      resolveWebBuildApiBaseUrl({
        GHOST_WEB_PRODUCTION: '1',
        GHOST_API_BASE_URL: 'http://127.0.0.1:3000'
      }),
    /must not use localhost/
  );
  assert.throws(
    () =>
      resolveWebBuildApiBaseUrl({
        VERCEL: '1',
        GHOST_API_BASE_URL: 'http://api.example.com'
      }),
    /require HTTPS/
  );
  assert.throws(
    () =>
      resolveWebBuildApiBaseUrl({
        VERCEL: '1',
        GHOST_API_BASE_URL: 'https://localhost:3000'
      }),
    /must not use localhost/
  );
});

test('production-simulated build:web ships Railway API and no localhost API config', () => {
  const api = 'https://ghost-protocol-production-f7ef.up.railway.app';
  const result = spawnSync('npm', ['run', 'build:web'], {
    cwd: root,
    env: {
      ...process.env,
      GHOST_WEB_PRODUCTION: '1',
      GHOST_API_BASE_URL: api
    },
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const config = fs.readFileSync(path.join(distWeb, 'assets', 'config.js'), 'utf8');
  const bundle = fs.readFileSync(path.join(distWeb, 'assets', 'auth.bundle.js'), 'utf8');
  const html = fs.readFileSync(path.join(distWeb, 'index.html'), 'utf8');

  assert.match(config, /window\.GHOST_API_BASE_URL = "https:\/\/ghost-protocol-production-f7ef\.up\.railway\.app"/);
  assert.doesNotMatch(config, /127\.0\.0\.1:3000|localhost:3000/);
  assert.doesNotMatch(bundle, /127\.0\.0\.1:3000|localhost:3000/);
  assert.doesNotMatch(config, /GOOGLE_CLIENT_SECRET\s*=|DATABASE_URL\s*=|ACCESS_TOKEN_SECRET\s*=/);
  assert.doesNotMatch(bundle, /GOOGLE_CLIENT_SECRET\s*=|DATABASE_URL\s*=|ACCESS_TOKEN_SECRET\s*=/);
  assert.match(html, /connect-src[^"]*https:\/\/ghost-protocol-production-f7ef\.up\.railway\.app/);
  assert.ok(html.indexOf('assets/config.js') < html.indexOf('assets/auth.bundle.js'));
  assert.match(bundle, /\/auth\/google/);
});

test('production-simulated build:web fails when API URL missing', () => {
  const result = spawnSync('npm', ['run', 'build:web'], {
    cwd: root,
    env: {
      ...process.env,
      GHOST_WEB_PRODUCTION: '1',
      GHOST_API_BASE_URL: '',
      API_PUBLIC_URL: ''
    },
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /require GHOST_API_BASE_URL|No localhost fallback/i);
});
