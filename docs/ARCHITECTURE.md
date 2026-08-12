# Ghost Protocol Architecture

Status: Phase 7 web + Vercel readiness complete (local; no production deploy). This document describes the **current** runtime system, what is **implemented**, and the **target** system. Items marked planned are not implemented yet.

Ghost Protocol is a single-user-scoped learning application (not multi-tenant). Private resources are owned by the authenticated user:

```
User
  ├── Session
  ├── Profile
  └── Progress
```

---

## Current architecture (Phase 7)

```
┌──────────────────────────────────────────────────────────────────┐
│ ELECTRON DESKTOP APP                                              │
│ Renderer → narrow preload → Main (safeStorage refresh)            │
└───────────────────────────────┬──────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│ WEB STATIC SPA (Vercel-ready dist/web)                            │
│ Same UI; access+refresh memory-only (no localStorage refresh)     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTP(S) JSON (Authorization: Bearer)
                                ▼
                 ┌──────────────────────────────┐
                 │  GHOST PROTOCOL BACKEND API  │
                 │  CORS allowlist FRONTEND_URL │
                 │  /auth/*  /me/profile        │
                 │  /me/progress                │
                 └──────────────┬───────────────┘
                                │ DATABASE_URL (server-only)
                                ▼
                         PostgreSQL
```

**Honest status**

| Item | Status |
|------|--------|
| Supabase runtime in Electron/web | **REMOVED / DEPRECATED** (`supabase/` LEGACY/HISTORICAL) |
| Backend API | **IMPLEMENTED** |
| Electron client → backend | **IMPLEMENTED** |
| Electron credential hardening | **IMPLEMENTED** (Phase 6 — Electron `safeStorage`) |
| Browser/web client → backend | **IMPLEMENTED** (Phase 7 — memory auth) |
| Web production build / vercel.json | **IMPLEMENTED** (readiness only; **NOT DEPLOYED**) |
| Railway / Vercel / Cloudflare deploy | **NOT DEPLOYED** |
| Google OAuth | **NOT IMPLEMENTED** (UI visible; temporarily unavailable) |
| Password reset | **NOT IMPLEMENTED** (UI visible; temporarily unavailable) |

### Electron trust boundary (IMPLEMENTED)

```
Renderer — UNTRUSTED
  UI + GhostProgress + API client
  Access token: memory
  NO Node.js / fs / path / shell / require
        │ narrow contextBridge (ghostDesktop)
        ▼
Preload — CONTROLLED BRIDGE
  Explicit authSession.store/load/clear + dormant OAuth hooks
  Validated IPC channels only
        │
        ▼
Main — PRIVILEGED
  safeStorage encrypt/decrypt
  navigation / openExternal / protocol validation
```

### Refresh credential storage (IMPLEMENTED / PLATFORM-DEPENDENT)

| Property | Status |
|----------|--------|
| Encryption before persist under `userData` | **IMPLEMENTED** via Electron `safeStorage` |
| Renderer never receives encryption keys | **IMPLEMENTED** |
| No plaintext persistent fallback | **IMPLEMENTED** (unavailable → re-login / `SESSION_STORAGE_FAILED`) |
| macOS Keychain-backed key material | **PLATFORM-DEPENDENT** — Electron documents Keychain use when encryption is available; unit tests do **not** prove Keychain |
| Windows DPAPI-backed key material | **PLATFORM-DEPENDENT** — per Electron docs |
| Linux OS secret store | **PLATFORM-DEPENDENT** — libsecret/kwallet when selected; `basic_text` rejected as unsuitable for persistence |
| Google OAuth | **PLANNED** |
| Password reset | **PLANNED** |

### Phase 2–5 backend + client (implemented)

- PostgreSQL pool, migrations, health endpoints
- Auth: register/login/refresh/logout/me (Argon2id, JWT access, hashed refresh + family reuse revocation)
- `GET/PUT /me/profile`, `GET/PUT /me/progress` — ownership from `req.auth.userId` only
- `src/api.js` + `src/auth.js` → backend; concurrent 401s share one in-flight refresh
- Startup progress sync barrier

Production hosting intent (not deployed yet): **Railway** for Backend API + PostgreSQL. See `docs/RAILWAY.md`.

---

## Target architecture

```
                         INTERNET
                            │
                            ▼
                 ┌─────────────────────┐
                 │     CLOUDFLARE      │
                 │ DNS / TLS / WAF     │
                 └──────────┬──────────┘
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
      ┌─────────────────┐          ┌─────────────────┐
      │     VERCEL      │          │ RAILWAY BACKEND │
      │ Ghost Web App   │ ─HTTPS─► │ Auth + /me/*    │
      └─────────────────┘          └────────┬────────┘
                                            ▼
                                   Railway PostgreSQL
```

### Critical trust path

```
Browser/Electron → HTTPS → Cloudflare → Railway Backend API → Railway PostgreSQL
```

**Neither the browser nor Electron may communicate directly with PostgreSQL.**

---

## Trust boundaries

### Electron trust boundary

1. **Renderer (untrusted relative to the host)** — UI + API client. Access tokens in memory. No Node integration.
2. **Preload** — frozen `window.ghostDesktop` only: `apiBaseUrl`, `authSession.{store,load,clear}`, dormant `beginOAuth` / `onAuthCallback`.
3. **Main** — `safeStorage`, fixed-path credential file, navigation locks, HTTPS `openExternal` allowlist, strict `ghost-protocol://auth/callback` validation (OAuth still dormant).

### Backend / database / edge

Unchanged from Phase 5: backend is the only component with `DATABASE_URL` and signing secrets. Cloudflare/Vercel remain **PLANNED** for production edge/web hosting.

---

## Repository layout (Phase 7)

```
/
├── docs/                 # ARCHITECTURE, SECURITY, THREAT_MODEL, RAILWAY, VERCEL
├── backend/              # API (Railway-intended)
├── electron/             # main, preload, security helpers
├── index.html            # shared UI (Electron + web)
├── src/                  # api.js + auth.js + platform.js
├── scripts/build-web.mjs # static web production build
├── vercel.json
├── tests/client/
├── tests/electron/
├── tests/web/
├── assets/
├── dist/web/             # build output (gitignored)
└── supabase/             # LEGACY/HISTORICAL only
```

---

## Explicit non-goals (still true)

- No Railway / Vercel / Cloudflare **production** deployment in Phase 7.
- No Google OAuth or password-reset backend.
- No multi-tenant / company model.
- Do not claim unit tests prove OS Keychain behavior.
- Do not persist browser refresh tokens in localStorage.
