# Ghost Protocol

Interactive cybersecurity learning platform delivered as a secure **Electron** desktop app and a **static web** client, backed by a first-party Node.js API and PostgreSQL.

> Screenshots: _placeholder — add product screenshots here before public marketing._

## Overview

Ghost Protocol preserves the original dashboard, missions, quizzes, XP mechanics, styling, and cinematic initialization sequence. Authentication and cloud progress sync go through the Ghost Protocol backend (`/auth/*`, `/me/profile`, `/me/progress`). Supabase is **not** used at runtime (`supabase/` is legacy/historical only).

## Architecture

```
┌──────────────────────────┐     ┌──────────────────────────┐
│  Electron desktop app    │     │  Web (static SPA)        │
│  Renderer → preload →    │     │  Browser (Vercel-ready)  │
│  main (safeStorage)      │     │  Memory-only auth tokens │
└────────────┬─────────────┘     └────────────┬─────────────┘
             │ HTTPS JSON                     │ HTTPS JSON
             └──────────────┬─────────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ Ghost Protocol API   │  (Railway-intended)
                 │ Auth + profile +     │
                 │ progress             │
                 └──────────┬───────────┘
                            ▼
                     PostgreSQL
```

Neither the browser nor Electron talks to PostgreSQL directly. Server secrets (`DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`) stay on the API host only.

See `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, and `docs/THREAT_MODEL.md`.

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
| CSP (Electron main + web build meta) | **IMPLEMENTED** |
| Google OAuth / password reset | **PLANNED** (UI visible; temporarily unavailable) |

## Stack

- **Desktop:** Electron 37, context-isolated renderer, electron-builder
- **Web:** Static SPA (`index.html` + `assets/`), Vercel-ready output in `dist/web`
- **API:** Node.js HTTP server under `backend/`
- **DB:** PostgreSQL (local or Railway-intended)
- **Client auth modules:** `src/api.js`, `src/auth.js`, `src/platform.js` → `assets/auth.bundle.js`

## Status: IMPLEMENTED vs PLANNED

| Item | Status |
|------|--------|
| Electron app + packaging scripts | **IMPLEMENTED** |
| Backend auth + profile/progress API | **IMPLEMENTED** |
| Electron ↔ backend wiring | **IMPLEMENTED** |
| Electron credential hardening (Phase 6) | **IMPLEMENTED** |
| Browser/web client parity (same UI, memory auth) | **IMPLEMENTED** (Phase 7) |
| Web production build + `vercel.json` | **IMPLEMENTED** (config/readiness only) |
| Private GitHub remote | **Phase 7** (when authenticated) |
| Railway Postgres + API deploy | **PLANNED** (not deployed) |
| Vercel production deploy | **PLANNED** (not deployed) |
| Cloudflare DNS / WAF | **PLANNED** |
| Google OAuth / password reset | **PLANNED** |

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

## Deployment architecture (intent — not deployed in Phase 7)

```
Internet → Cloudflare (planned) → Vercel static web (planned)
                                → Railway API + Postgres (planned)
Electron / browser ──HTTPS──► Railway API ──► Postgres
```

- **Vercel:** static web only (`vercel.json`, `npm run build:web`). No production deploy in Phase 7.
- **Railway:** backend + Postgres. See `docs/RAILWAY.md`.
- **Docs:** `docs/VERCEL.md` for web readiness checklist.

## License

UNLICENSED / private.
