# Railway production architecture (prepared, not deployed)

Status: **documented readiness only**. No Railway project, service, database, domain, Cloudflare, or Vercel wiring has been created by this repository phase.

## Target production trust path

```
Vercel Web Client
        │
        │ HTTPS
        ▼
Cloudflare / public API boundary
        │
        ▼
Railway Backend API
        │
        │ DATABASE_URL (server-side only)
        ▼
Railway PostgreSQL

Electron Desktop
        │
        │ HTTPS
        └────────────► Railway Backend API
```

Hard rule: neither Vercel client code nor Electron may connect directly to PostgreSQL.

## Backend service readiness (implemented in code)

| Requirement | Status |
|-------------|--------|
| Listen on `process.env.PORT` | Implemented |
| Bind `0.0.0.0` for container networking | Implemented (`HOST` overridable) |
| `DATABASE_URL` from environment only | Implemented |
| Production startup fails if `DATABASE_URL` missing/invalid | Implemented |
| No secrets in startup logs | Implemented |
| PostgreSQL pool closed on SIGINT/SIGTERM | Implemented |
| Start command | `npm start` (`node src/app.js`) |
| No Docker required for Railway Nixpacks/node deploy | Intentional |

## Recommended Railway setup (later deployment phase)

1. Create a Railway project.
2. Add a **PostgreSQL** plugin/service.
3. Add a **backend** service from this GitHub repo with:
   - **Root Directory:** `backend`
   - **Start Command:** `npm start` (or Railway default detecting `package.json` scripts)
   - **Watch/build:** `npm install` in `backend`
4. Set backend variables:
   - `NODE_ENV=production`
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}` (private/internal URL preferred)
   - `FRONTEND_URL` / `API_PUBLIC_URL` when CORS and redirects exist (Phase 3+)
   - Auth secrets only when Phase 3 lands
5. Run migrations once from a secure operator context:
   - `npm run db:migrate` against the Railway DB using a one-off/run command or CI job with server-side credentials
6. Expose the backend HTTP service publicly (Railway domain), then place Cloudflare in front later.

Do **not** set `DATABASE_URL`, `VITE_DATABASE_URL`, or `NEXT_PUBLIC_DATABASE_URL` on Vercel or in Electron.

## PostgreSQL TLS behavior

| Environment | Default TLS | Certificate validation |
|-------------|-------------|------------------------|
| `NODE_ENV=development` | Off unless `DATABASE_SSL=require` or URL `sslmode=require` | N/A when TLS off |
| `NODE_ENV=production` | On | `rejectUnauthorized: true` by default |

Optional:

- `DATABASE_SSL=require|disable` — explicit override
- `DATABASE_SSL_CA=/path/to/ca.pem` — trust a provided CA while keeping validation on
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` — **explicit weakening only**; document residual MITM risk if Railway's presented certificate cannot be validated with a CA yet

This project does **not** default to disabling certificate validation merely to make Railway connect.

## What remains for a later Railway deployment phase

- Create Railway project + Postgres + backend service
- Connect GitHub repo / set Root Directory to `backend`
- Inject `DATABASE_URL` via Railway variable reference
- Decide public networking + Cloudflare DNS/proxy
- Run migrations against Railway Postgres
- Confirm `/health` and `/health/db` from the public URL
- Add auth secrets and CORS origins after Phase 3+
- Wire Vercel + Electron to the public API URL only (never to Postgres)
