# Ghost Protocol Backend

Phase 6 companion: PostgreSQL persistence, authentication, user-scoped profile/progress APIs, and Electron client wiring with hardened desktop credential storage.

## Implemented

- `pg` pool + SQL migrations (`users`, `sessions`, `profiles`, `user_progress`)
- Auth endpoints:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`
- User-scoped endpoints (identity from access token only):
  - `GET /me/profile`, `PUT /me/profile`
  - `GET /me/progress`, `PUT /me/progress`
- Argon2id passwords, JWT access tokens, hashed refresh sessions with rotation
- `GET /health`, `GET /health/db`
- Railway-oriented process readiness (`PORT`, production config gate, graceful shutdown)
- Electron desktop client calls these endpoints (see root `src/api.js` / `src/auth.js`)
- Desktop refresh persistence uses Electron `safeStorage` via main-process `authSession` (see root `docs/SECURITY.md`)

## Ownership rule

**CLIENT OWNERSHIP IDENTIFIERS ARE NEVER AUTHORITATIVE.**  
`/me/*` always scopes to `req.auth.userId` from a verified access token. Body fields like `user_id` / `userId` / `id` are ignored or rejected for unsupported keys.

## Not implemented

- Google OAuth / password reset
- Railway / Cloudflare / Vercel deployment

## Local setup

```bash
cd backend
cp .env.example .env
# set DATABASE_URL, ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET
npm run db:migrate
npm start
```

Default listen: `http://127.0.0.1:3000` (or `HOST`/`PORT` from env).

From the repo root, run the Electron app against that API:

```bash
# optional override (also used for CSP connect-src)
export GHOST_API_BASE_URL=http://127.0.0.1:3000
npm start
```

Packaged/production Electron builds must use an `https:` API base URL (loopback HTTP remains allowed for local development only).

## Tests

```bash
cd backend
npm test
```

Integration tests that need a live database skip when `DATABASE_URL` is unset. Do not treat a green unit run as full live-PG E2E.
