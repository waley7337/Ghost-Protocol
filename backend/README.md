# Ghost Protocol Backend

Phase 4 provides PostgreSQL persistence, authentication, and user-scoped profile/progress APIs.

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

## Ownership rule

**CLIENT OWNERSHIP IDENTIFIERS ARE NEVER AUTHORITATIVE.**  
`/me/*` always scopes to `req.auth.userId` from a verified access token. Body fields like `user_id` / `userId` / `id` are ignored or rejected for unsupported keys.

## Not implemented / not wired

- Electron or web client migration off Supabase
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

Root Electron `npm start` is unchanged and still uses the legacy Supabase client.
