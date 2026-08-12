/**
 * UNIT tests for auth UI integration helpers (Phase 5).
 * Distinguishes from LIVE PG / full E2E — pure logic only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('src/auth.js has no Supabase runtime imports or dead project host', () => {
  const auth = fs.readFileSync(path.join(root, 'src/auth.js'), 'utf8');
  assert.doesNotMatch(auth, /@supabase\/supabase-js/);
  assert.doesNotMatch(auth, /createClient\s*\(/);
  assert.doesNotMatch(auth, /lkbdybejiiijocnhwmvm\.supabase\.co/);
  assert.doesNotMatch(auth, /supabase\.auth/);
  assert.doesNotMatch(auth, /supabase\.from\s*\(/);
  assert.match(auth, /from '\.\/api\.js'/);
  assert.match(auth, /syncEnabled/);
  assert.match(auth, /progress_not_found/);
  assert.match(auth, /Google sign-in is temporarily unavailable/);
  assert.match(auth, /Password reset is temporarily unavailable/);
});

test('src/api.js never references Supabase', () => {
  const api = fs.readFileSync(path.join(root, 'src/api.js'), 'utf8');
  assert.doesNotMatch(api, /supabase/i);
  assert.match(api, /refreshInFlight/);
  assert.match(api, /\/auth\/login/);
  assert.match(api, /\/me\/progress/);
});

test('root package.json does not depend on @supabase/supabase-js', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['@supabase/supabase-js'], undefined);
});
