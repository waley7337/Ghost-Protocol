# Ghost Protocol

Ghost Protocol is an interactive cybersecurity learning platform packaged as a secure, cross-platform Electron application. The original dashboard, missions, quizzes, XP mechanics, styling, and interactions are preserved; the existing initialization screen provides the cinematic desktop startup sequence.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Install and run

```bash
npm install
cd backend && npm install && cp .env.example .env
# configure DATABASE_URL, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET
npm run db:migrate
npm start
```

In another terminal (repo root):

```bash
export GHOST_API_BASE_URL=http://127.0.0.1:3000   # optional; this is the default
npm start
```

Progress is stored locally under the `ghost_protocol` local-storage key and synced to the backend after authentication.

## Authentication (Phase 5–6)

The desktop client talks to the Ghost Protocol backend API (`src/api.js` / `src/auth.js`):

| UI action | API |
|-----------|-----|
| Create account | `POST /auth/register` (immediate session) |
| Sign in | `POST /auth/login` |
| Session restore | refresh → `GET /auth/me` → profile/progress |
| Logout | `POST /auth/logout` + local clear |
| Profile / progress | `GET/PUT /me/profile`, `GET/PUT /me/progress` |

- Access tokens stay in memory.
- Refresh tokens persist via Electron main-process `authSession` + `safeStorage` encryption at rest when available. If secure storage is unavailable, the app prefers re-login over plaintext persistence (PLATFORM-DEPENDENT OS backends; unit tests do not prove Keychain).
- Google sign-in and password reset remain **visible but temporarily unavailable** (no Supabase; no backend yet). The `ghost-protocol://` deep-link architecture is retained for a later OAuth phase.
- Supabase is **not** used at runtime. The `supabase/` folder is legacy/historical only.

**Not deployed yet:** Railway, Vercel, Cloudflare.

## Verify

```bash
npm run lint
npm test
npm run auth:bundle
npm run smoke:electron
cd backend && npm test
```

## Package

Run the matching command natively on each release platform:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

Artifacts are written to `release/`. macOS creates DMG and ZIP files, Windows creates NSIS installer, and Linux creates AppImage and Debian packages.

Public distribution requires platform signing credentials: Apple Developer ID signing/notarization for macOS and an Authenticode certificate for Windows.

## Security

The renderer uses context isolation, disabled Node integration, Chromium sandboxing, locked navigation, blocked webviews, a minimal frozen preload bridge (`authSession` only for credentials), HTTPS-only external opens, and a restrictive Content Security Policy (`connect-src` allowlists the configured API base URL; no `unsafe-eval`). Production API base URLs must be HTTPS (loopback HTTP allowed for local development).
