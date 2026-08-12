# Ghost Protocol Backend

Phase 3 provides PostgreSQL persistence plus email/password authentication foundations.

## Implemented

- `pg` pool + SQL migrations (`users`, `sessions`, `profiles`, `user_progress`)
- Auth endpoints:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `GET /auth/me`
- Argon2id passwords, JWT access tokens, hashed refresh sessions with rotation
- `GET /health`, `GET /health/db`
- Railway-oriented process readiness (`PORT`, production config gate, graceful shutdown)

## Not implemented / not wired

- Electron or web client migration off Supabase
- Profile/progress HTTP APIs
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
