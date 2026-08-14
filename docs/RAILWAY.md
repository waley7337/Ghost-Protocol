# Railway production architecture

Status: **deployed in production** (operator-verified Phase 8). Public API origin:

`https://ghost-protocol-production-f7ef.up.railway.app`

This document describes the trust path, readiness controls in code, and remaining residuals (Cloudflare, TLS caveats). It does **not** contain secrets.

## Production trust path

```
Vercel Web Client (ghost-protocol-pi.vercel.app)
        │
        │ HTTPS
        ▼
Public API boundary (Cloudflare / WAF still PLANNED)
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
| Migrations `001`–`006` | Applied in production (Phase 8 ops) |

## Production checklist (ops — no secrets here)

1. Railway project with PostgreSQL + backend service (`Root Directory: backend`).
2. Server-only vars: `DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, Google OAuth server vars, `FRONTEND_URL` (Vercel origin allowlist).
3. Public health: `GET /health`, `GET /health/db`.
4. Clients use the public HTTPS API origin only — never Postgres.

Do **not** set `DATABASE_URL`, `VITE_DATABASE_URL`, or `NEXT_PUBLIC_DATABASE_URL` on Vercel or in Electron.

## TLS notes

- Prefer Railway's **private** `DATABASE_URL` (`*.railway.internal`) between API and Postgres. Private-mesh hosts skip TLS by default because they do not present publicly verifiable certificates; this is not a public-network MITM tradeoff.
- Public proxy URLs still default to TLS with certificate validation.
- `DATABASE_SSL_REJECT_UNAUTHORIZED=false` is an **explicit weakening only**; document residual MITM risk if used.

## Residuals (Phase 9)

- Cloudflare / WAF in front of the API: still **PLANNED**.
- In-process rate limits only (not distributed).
- Do not claim conflict-safe concurrent multi-device sync (WAL-251).
- Full residual register: `docs/PHASE-9-AUDIT.md`.
