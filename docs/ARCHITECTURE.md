# Ghost Protocol Architecture

Status: **Production deployed** (Phase 8 operator acceptance 2026-08-14). Web on Vercel, API + PostgreSQL on Railway. Phase 9 WP1 documents residual risks — see `docs/PHASE-9-AUDIT.md`. Items marked planned are not implemented yet.

Ghost Protocol is a single-user-scoped learning application (not multi-tenant). Private resources are owned by the authenticated user:

```
User
  ├── Session
  ├── Profile
  └── Progress
```

---

## Current architecture (production)

```
┌──────────────────────────────────────────────────────────────────┐
│ ELECTRON DESKTOP APP                                              │
│ Renderer → narrow preload → Main (safeStorage refresh)            │
│ Google OAuth: openExternal + ghost-protocol://auth/callback       │
└───────────────────────────────┬──────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────┐
│ WEB STATIC SPA (Vercel: ghost-protocol-pi.vercel.app)             │
│ Same UI; access+refresh memory-only (no localStorage refresh)     │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTPS JSON (Authorization: Bearer)
                                ▼
                 ┌──────────────────────────────┐
                 │  GHOST PROTOCOL BACKEND API  │
                 │  Railway production service  │
                 │  CORS allowlist FRONTEND_URL │
                 │  /auth/*  /me/profile        │
                 │  /me/progress                │
                 └──────────────┬───────────────┘
                                │ DATABASE_URL (server-only)
                                ▼
                    Railway PostgreSQL
```

**Honest status**

| Item | Status |
|------|--------|
| Supabase runtime in Electron/web | **REMOVED / DEPRECATED** (`supabase/` LEGACY/HISTORICAL) |
| Backend API | **IMPLEMENTED** + **DEPLOYED** (Railway) |
| Electron client → backend | **IMPLEMENTED** (packaged default → Railway HTTPS) |
| Electron credential hardening | **IMPLEMENTED** (Phase 6 — Electron `safeStorage`) |
| Browser/web client → backend | **IMPLEMENTED** (Phase 7 — memory auth) + **DEPLOYED** (Vercel) |
| Web production build / vercel.json | **IMPLEMENTED** + production deploy |
| Railway API + Postgres | **DEPLOYED** |
| Cloudflare DNS / WAF | **NOT DEPLOYED** (planned) |
| Google OAuth | **IMPLEMENTED** (web + Electron; production operator-verified). Residual **H1** auto-link risk — see Phase 9 audit |
| Password reset | **NOT IMPLEMENTED** (UI visible; temporarily unavailable) |
| Concurrent multi-device sync safety | **NOT CLAIMED** — full-snapshot LWW; [WAL-251](https://linear.app/waley-nagdi/issue/WAL-251/add-optimistic-concurrency-protection-to-cross-device-progress) |
| Public Electron signing/notarization | **NOT CONFIGURED** (**H2** — NO-GO for public desktop distribution) |

### Electron trust boundary (IMPLEMENTED)

```
Renderer — UNTRUSTED
  UI + GhostProgress + API client
  Access token: memory
  NO Node.js / fs / path / shell / require
        │ narrow contextBridge (ghostDesktop)
        ▼
Preload — CONTROLLED BRIDGE
  Explicit authSession.store/load/clear + Google OAuth begin/callback hooks
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
| Google OAuth | **IMPLEMENTED** (residual H1 — Phase 9) |
| Password reset | **PLANNED** |

### Phase 2–8 backend + client (implemented)

- PostgreSQL pool, migrations `001`–`006`, health endpoints
- Auth: register/login/refresh/logout/me (Argon2id, JWT access, hashed refresh + family reuse revocation)
- Google OAuth start/callback/exchange
- `GET/PUT /me/profile`, `GET/PUT /me/progress` — ownership from `req.auth.userId` only; progress is full-snapshot LWW
- `src/api.js` + `src/auth.js` → backend; concurrent 401s share one in-flight refresh
- Startup progress sync barrier

**Production hosting:** Railway for Backend API + PostgreSQL; Vercel for static web. Cloudflare still planned. See `docs/RAILWAY.md`, `docs/VERCEL.md`, residual risks in `docs/PHASE-9-AUDIT.md`.

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
2. **Preload** — frozen `window.ghostDesktop` only: `apiBaseUrl`, `authSession.{store,load,clear}`, `beginOAuth` / `onAuthCallback`.
3. **Main** — `safeStorage`, fixed-path credential file, navigation locks, HTTPS `openExternal` allowlist (including Google OAuth start URLs), strict `ghost-protocol://auth/callback` validation.

### Backend / database / edge

Backend is the only component with `DATABASE_URL` and signing secrets. **Vercel** (web) and **Railway** (API + Postgres) are **deployed**. Cloudflare edge/WAF remains **PLANNED**.

---

## Repository layout

```
/
├── docs/                 # ARCHITECTURE, SECURITY, THREAT_MODEL, RAILWAY, VERCEL, PHASE-*-*
├── backend/              # API (Railway production)
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
