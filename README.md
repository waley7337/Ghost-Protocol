# Ghost Protocol

Ghost Protocol is an interactive cybersecurity learning platform packaged as a secure, cross-platform Electron application. The original dashboard, missions, quizzes, XP mechanics, styling, and interactions are preserved; the existing initialization screen provides the cinematic desktop startup sequence.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install and run

```bash
npm install
npm start
```

Progress is stored locally under the `ghost_protocol` local-storage key.

## Verify

```bash
npm run lint
npm run build:dir
```

## Package

Run the matching command natively on each release platform:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

Artifacts are written to `release/`. macOS creates DMG and ZIP files, Windows creates an NSIS installer, and Linux creates AppImage and Debian packages.

Public distribution requires platform signing credentials: Apple Developer ID signing/notarization for macOS and an Authenticode certificate for Windows.

## Security

The renderer uses context isolation, disabled Node integration, Chromium sandboxing, locked navigation, blocked webviews, no exposed IPC/native API, and a restrictive Content Security Policy.

## Supabase authentication setup

The desktop client is configured for project `lkbdybejiiijocnhwmvm`. Its publishable key is intentionally safe to ship in a client application; never add a `service_role` key to this repository.

1. Open the Supabase SQL Editor and run [`supabase/migrations/202607080001_auth_and_progress.sql`](supabase/migrations/202607080001_auth_and_progress.sql). This creates user profiles and per-user progress with row-level security.
2. In **Authentication → URL Configuration**, add `ghost-protocol://auth/callback` to Redirect URLs.
   For a hosted web build, also add its exact HTTPS URL (for example `https://app.example.com/`).
3. In **Authentication → Providers**, keep Email enabled and enable Google.
4. In Google Cloud, create OAuth web credentials and add `https://lkbdybejiiijocnhwmvm.supabase.co/auth/v1/callback` as an authorized redirect URI.
5. Paste the Google client ID and secret into the Supabase Google provider settings.

Google authentication uses the provider redirect flow on the web. In Electron it opens the system browser and uses PKCE, returning through the registered `ghost-protocol://` deep link. Sessions persist and refresh automatically on both platforms. If cloud sync is temporarily unavailable, an existing authenticated session can continue with locally cached progress and sync again after connectivity returns.
