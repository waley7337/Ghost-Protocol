# Ghost Protocol Backend

Phase 2 provides the PostgreSQL data foundation and health endpoints.

## What is implemented

- `pg` connection pool (server-side only)
- SQL migrations for `users`, `sessions`, `profiles`, `user_progress`
- Migration runner: `npm run db:migrate` / `npm run db:status`
- `GET /health`
- `GET /health/db` (returns only `{ "status": "ok" }` or `{ "status": "unavailable" }`)

## What is not implemented

- Authentication / sessions issuance
- Profile or progress HTTP APIs
- Wiring from Electron or the web client

## Local setup

1. Create a PostgreSQL database.
2. Prefer a least-privilege application role (see `docs/SECURITY.md`).
3. Copy `.env.example` to `.env` and set `DATABASE_URL` (never commit `.env`).
4. Run migrations:

```bash
cd backend
npm run db:migrate
npm run db:status
npm start
```

Root Electron `npm start` is unchanged and does not use this backend yet.
