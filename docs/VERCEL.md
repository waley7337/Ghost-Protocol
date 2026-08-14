# Vercel production (web)

Status: **deployed in production** (operator-verified Phase 8). Public web origin:

`https://ghost-protocol-pi.vercel.app`

API origin (Railway): `https://ghost-protocol-production-f7ef.up.railway.app`

This document describes what ships to Vercel and browser-auth honesty. No secrets.

## What ships to Vercel

- Static SPA from `dist/web` (`index.html`, `assets/**`)
- Build: `npm run build:web` (`scripts/build-web.mjs`)
- Config: root `vercel.json` (`outputDirectory: dist/web`)

## Allowed Vercel env (public client only)

| Variable | Purpose |
|----------|---------|
| `GHOST_API_BASE_URL` | HTTPS origin of the Ghost Protocol API (injected into `assets/config.js` at build) |

Optional alias understood by the build script: `API_PUBLIC_URL`.

Production/Vercel builds **fail** if this value is missing, non-HTTPS, or loopback (`localhost` / `127.0.0.1` / `::1`). There is no silent localhost fallback on Vercel.

Google OAuth client secrets are **never** set on Vercel. The browser only navigates to the API `/auth/google` start URL.

## Forbidden on Vercel (never)

- `DATABASE_URL`
- `ACCESS_TOKEN_SECRET`
- `REFRESH_TOKEN_SECRET`
- Postgres passwords / connection strings
- Any `VITE_DATABASE_URL` / `NEXT_PUBLIC_DATABASE_URL` style server secrets

## Browser auth limitation (honest)

Electron persists refresh tokens via main-process `safeStorage` when available.

The **web** client uses **memory-only** access + refresh tokens (no `localStorage` / `sessionStorage` refresh persistence). Closing the browser tab ends the session. A stronger browser session strategy (httpOnly cookies, BFF, etc.) is **PLANNED**, not implemented.

Google OAuth on web is **IMPLEMENTED** (redirect + exchange). **H1** email auto-link: fixed in code pending production verification — `docs/PHASE-9-AUDIT.md`.

## CORS

The API allowlists browser origins via backend `FRONTEND_URL` (comma-separated). Production should include the Vercel HTTPS origin.

## CSP / headers

- Electron: CSP applied in main via `session.webRequest`
- Web build: CSP `<meta>` injected into `dist/web/index.html` with `connect-src` including the public API origin
- `vercel.json` adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`
- **CSP response header** on Vercel is still **PLANNED** (Phase 9 WP5 / M6) — meta CSP alone is the current web control

## Local verify (no deploy)

```bash
export GHOST_API_BASE_URL=http://127.0.0.1:3000
npm run build:web
npm run web:dev
```

## Residuals

- Soft unlock if progress sync fails; LWW progress (no concurrent-edit claims).
- Full Phase 9 register: `docs/PHASE-9-AUDIT.md`.
