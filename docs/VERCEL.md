# Vercel readiness (Phase 7)

Status: **configuration and local production web build only**. No production Vercel project link/deploy in this phase.

## What ships to Vercel

- Static SPA from `dist/web` (`index.html`, `assets/**`)
- Build: `npm run build:web` (`scripts/build-web.mjs`)
- Config: root `vercel.json` (`outputDirectory: dist/web`)

## Allowed Vercel env (public client only)

| Variable | Purpose |
|----------|---------|
| `GHOST_API_BASE_URL` | HTTPS origin of the Ghost Protocol API (injected into `assets/config.js` at build) |

Optional alias understood by the build script: `API_PUBLIC_URL`.

## Forbidden on Vercel (never)

- `DATABASE_URL`
- `ACCESS_TOKEN_SECRET`
- `REFRESH_TOKEN_SECRET`
- Postgres passwords / connection strings
- Any `VITE_DATABASE_URL` / `NEXT_PUBLIC_DATABASE_URL` style server secrets

## Browser auth limitation (honest)

Electron persists refresh tokens via main-process `safeStorage` when available.

The **web** client uses **memory-only** access + refresh tokens (no `localStorage` / `sessionStorage` refresh persistence). Closing the browser tab ends the session. A stronger browser session strategy (httpOnly cookies, BFF, etc.) is **PLANNED**, not implemented.

## CORS

The API allowlists browser origins via backend `FRONTEND_URL` (comma-separated). Before a real deploy, set Railway `FRONTEND_URL` to the Vercel HTTPS origin.

## CSP / headers

- Electron: CSP applied in main via `session.webRequest`
- Web build: CSP `<meta>` injected into `dist/web/index.html` with `connect-src` including the public API origin
- `vercel.json` adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`

## Local verify (no deploy)

```bash
export GHOST_API_BASE_URL=http://127.0.0.1:3000
npm run build:web
# inspect dist/web ; optional: npm run web:dev
vercel --version   # CLI present; do not vercel --prod in Phase 7
```

## Still required before actual Vercel deployment (Phase 8+)

1. Private GitHub connected (Phase 7) and Vercel project linked from GitHub
2. Railway API + Postgres live with production secrets
3. `GHOST_API_BASE_URL` = Railway HTTPS API URL (Vercel build env)
4. Railway `FRONTEND_URL` = Vercel HTTPS origin
5. Confirm CORS + CSP `connect-src` match
6. Explicit approval to production-deploy
