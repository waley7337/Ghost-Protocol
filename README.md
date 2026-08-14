# Ghost Protocol

Interactive cybersecurity learning platform delivered as a secure **Electron** desktop app and a **static web** client, backed by a first-party Node.js API and PostgreSQL.

> Screenshots: _placeholder — add product screenshots here before public marketing._

## Overview

Ghost Protocol preserves the original dashboard, missions, quizzes, XP mechanics, styling, and cinematic initialization sequence. Authentication and cloud progress sync go through the Ghost Protocol backend (`/auth/*`, `/me/profile`, `/me/progress`). Supabase is **not** used at runtime (`supabase/` is legacy/historical only).

## Architecture

```
┌──────────────────────────┐     ┌──────────────────────────┐
│  Electron desktop app    │     │  Web (static SPA)        │
│  Renderer → preload →    │     │  Browser (Vercel)        │
│  main (safeStorage)      │     │  Memory-only auth tokens │
└────────────┬─────────────┘     └────────────┬─────────────┘
             │ HTTPS JSON                     │ HTTPS JSON
             └──────────────┬─────────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ Ghost Protocol API   │  (Railway production)
                 │ Auth + profile +     │
                 │ progress             │
                 └──────────┬───────────┘
                            ▼
                     Railway PostgreSQL
```

Neither the browser nor Electron talks to PostgreSQL directly. Server secrets (`DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`) stay on the API host only.

See `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/THREAT_MODEL.md`, and Phase 9 residuals in `docs/PHASE-9-AUDIT.md`.

## Security highlights

| Area | Status |
|------|--------|
| Electron `contextIsolation` / no Node in renderer / sandbox / `webSecurity` | **IMPLEMENTED** |
| Narrow preload (`ghostDesktop.authSession` only for credentials) | **IMPLEMENTED** |
| Electron refresh at rest via `safeStorage` (platform-dependent) | **IMPLEMENTED** |
| Browser refresh persistence | **Memory-only** (no `localStorage` refresh) |
| Access tokens | **Memory-only** on both platforms |
| Backend Argon2id + JWT access + hashed refresh rotation | **IMPLEMENTED** |
| CORS allowlist via `FRONTEND_URL` | **IMPLEMENTED** (browser) |
| CSP (Electron main + web build meta) | **IMPLEMENTED** (Vercel CSP **header** still planned) |
| Google OAuth | **IMPLEMENTED** (web + Electron; residual H1 auto-link — see Phase 9) |
| Password reset | **PLANNED** (UI visible; temporarily unavailable) |
| Public Electron signing / notarization | **NOT CONFIGURED** (NO-GO for public desktop) |

## Stack

- **Desktop:** Electron 37, context-isolated renderer, electron-builder
- **Web:** Static SPA (`index.html` + `assets/`), Vercel production at `https://ghost-protocol-pi.vercel.app`
- **API:** Node.js HTTP server under `backend/` on Railway (`https://ghost-protocol-production-f7ef.up.railway.app`)
- **DB:** Railway PostgreSQL
- **Client auth modules:** `src/api.js`, `src/auth.js`, `src/platform.js` → `assets/auth.bundle.js`

## Status: IMPLEMENTED vs PLANNED

| Item | Status |
|------|--------|
| Electron app + packaging scripts | **IMPLEMENTED** |
| Backend auth + profile/progress API | **IMPLEMENTED** |
| Electron ↔ backend wiring | **IMPLEMENTED** |
| Electron credential hardening (Phase 6) | **IMPLEMENTED** |
| Browser/web client parity (same UI, memory auth) | **IMPLEMENTED** (Phase 7) |
| Web production build + `vercel.json` | **IMPLEMENTED** + **DEPLOYED** |
| Railway Postgres + API deploy | **DEPLOYED** |
| Vercel production deploy | **DEPLOYED** |
| Cloudflare DNS / WAF | **PLANNED** |
| Google OAuth | **IMPLEMENTED** (residual account-link risk H1) |
| Password reset | **PLANNED** |
| Conflict-safe concurrent multi-device sync | **PLANNED** (WAL-251; LWW today) |
| Public signed/notarized Electron | **PLANNED** (Phase 10; H2 blocker) |

## Requirements

- Node.js 22+
- npm 10+
- PostgreSQL for backend features

## Environment setup (placeholders only)

### Backend (`backend/.env`)

Copy `backend/.env.example` → `backend/.env` and replace placeholders:

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
ACCESS_TOKEN_SECRET=replace-with-long-random-access-secret-at-least-32-chars
REFRESH_TOKEN_SECRET=replace-with-long-random-refresh-secret-at-least-32-chars
FRONTEND_URL=http://127.0.0.1:4173
```

Never commit real values. Never put these in Vercel public env, Electron renderer bundles, or `assets/config.js`.

### Clients (public only)

```bash
# Electron / local web — public API origin only
export GHOST_API_BASE_URL=http://127.0.0.1:3000
```

For hosted web builds, set **public** `GHOST_API_BASE_URL` (HTTPS API origin) at build time. Do **not** set `DATABASE_URL` / token secrets in Vercel.

## Local development

### Backend

```bash
cd backend
npm install
cp .env.example .env   # then edit placeholders
npm run db:migrate
npm start
```

### Electron

```bash
npm install
export GHOST_API_BASE_URL=http://127.0.0.1:3000   # optional; default
npm start
```

### Web (browser)

```bash
npm install
export GHOST_API_BASE_URL=http://127.0.0.1:3000
npm run build:web
npm run web:dev          # serves dist/web on :4173
```

**Browser auth note:** refresh and access tokens stay in memory for the tab session. Closing the tab ends the session. Electron can persist refresh material via `safeStorage` when available. Progress may still use the existing `ghost_protocol` localStorage key as a non-authoritative cache.

## Testing

```bash
npm run lint
npm test                 # client + electron + web unit tests
npm run auth:bundle
npm run smoke:electron
cd backend && npm test
```

## Build / packaging

```bash
# Web (Vercel-ready static output → dist/web)
GHOST_API_BASE_URL=https://api.example.com npm run build:web

# Electron (run on each target OS)
npm run build:mac
npm run build:win
npm run build:linux
```

Artifacts: web → `dist/web/`; desktop → `release/`. Public desktop distribution still requires platform signing credentials.

## Deployment architecture (production)

```
Internet → Cloudflare (planned) → Vercel static web (deployed)
                                → Railway API + Postgres (deployed)
Electron / browser ──HTTPS──► Railway API ──► Postgres
```

- **Vercel:** static web — `https://ghost-protocol-pi.vercel.app` (`vercel.json`, `npm run build:web`). See `docs/VERCEL.md`.
- **Railway:** backend + Postgres — `https://ghost-protocol-production-f7ef.up.railway.app`. See `docs/RAILWAY.md`.
- **Desktop:** packaged builds may target Railway; **public** distribution requires signing/notarization (not configured — see `docs/PHASE-9-AUDIT.md`).
- **Honesty:** Sequential cross-device sync works; concurrent multi-device conflict safety is **not** claimed (WAL-251).

## License

UNLICENSED / private.
