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
  assert.match(auth, /resetLocalProgressForNewSession|canonicalEmptyProgress/);
  assert.match(auth, /putProgress\(empty\)/);
  assert.doesNotMatch(auth, /putProgress\(local\)/);
  assert.match(auth, /exchangeGoogle|buildGoogleStartUrl|google_exchange/);
  assert.match(auth, /readGoogleCallbackParams|#google_exchange|hash/);
  assert.match(auth, /Password reset is temporarily unavailable/);
  assert.doesNotMatch(auth, /Google sign-in is temporarily unavailable/);
  // Visual parity with pre-Phase-5 auth card: Google / OR / Forgot remain visible.
  assert.match(auth, /class="auth-btn auth-btn-google" id="auth-google"/);
  assert.match(auth, /class="auth-divider">OR<\/div>/);
  assert.match(auth, /class="auth-link" id="auth-forgot">Forgot password\?<\/button>/);
  assert.doesNotMatch(auth, /id="auth-google"[^>]*auth-hidden/);
  assert.doesNotMatch(auth, /id="auth-forgot"[^>]*auth-hidden/);
  assert.doesNotMatch(auth, /auth-google-divider/);
});

test('src/api.js never references Supabase', () => {
  const api = fs.readFileSync(path.join(root, 'src/api.js'), 'utf8');
  assert.doesNotMatch(api, /supabase/i);
  assert.match(api, /refreshInFlight/);
  assert.match(api, /\/auth\/login/);
  assert.match(api, /\/me\/progress/);
  assert.match(api, /from '\.\/platform\.js'/);
  assert.match(api, /createMemoryTokenStorage|mode: 'memory'/);
});

test('root package.json does not depend on @supabase/supabase-js', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['@supabase/supabase-js'], undefined);
});
