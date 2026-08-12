# Ghost Protocol Architecture

Status: Phase 5 client migration complete (local). This document describes the **current** runtime system, what is **implemented**, and the **target** system. Items marked planned are not implemented yet.

Ghost Protocol is a single-user-scoped learning application (not multi-tenant). Private resources are owned by the authenticated user:

```
User
  ├── Session
  ├── Profile
  └── Progress
```

---

## Current architecture (Phase 5)

```
┌──────────────────────────────────────────────────────────────────┐
│                     ELECTRON DESKTOP APP                         │
│  main → preload → renderer (index.html + auth.bundle.js)         │
│  localStorage progress cache + Ghost Protocol API client         │
│  refresh token via main-process userData bridge (not keychain)   │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTP(S) JSON (Authorization: Bearer)
                                ▼
                 ┌──────────────────────────────┐
                 │  GHOST PROTOCOL BACKEND API  │
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
| Supabase runtime in Electron | **REMOVED / DEPRECATED** (SQL under `supabase/` kept as LEGACY/HISTORICAL) |
| Backend API | **IMPLEMENTED** |
| Electron client → backend | **IMPLEMENTED** (Phase 5) |
| Railway / Vercel / Cloudflare deploy | **NOT DEPLOYED** |
| OS keychain refresh storage | **PLANNED** (Phase 6) — current: main-process userData file via IPC |
| Google OAuth | **NOT IMPLEMENTED** (UI hidden; deep-link architecture retained) |
| Password reset | **NOT IMPLEMENTED** (UI hidden) |

### Phase 2–4 backend (implemented)

- PostgreSQL pool, migrations, health endpoints
- Auth: register/login/refresh/logout/me (Argon2id, JWT access, hashed refresh + family reuse revocation)
- `GET/PUT /me/profile`, `GET/PUT /me/progress` — ownership from `req.auth.userId` only

### Phase 5 client (implemented)

- `src/api.js` + rewritten `src/auth.js` (bundled to `assets/auth.bundle.js`)
- Maps former Supabase calls to backend endpoints
- Startup progress sync barrier (auth → load server progress → hydrate/init → enable sync)
- CSP `connect-src` allowlists the configured API base URL (`GHOST_API_BASE_URL` / default `http://127.0.0.1:3000`)

Production hosting intent (not deployed yet): **Railway** for Backend API + PostgreSQL. See `docs/RAILWAY.md`.

---

## Target architecture

```
                         INTERNET
                            │
                            ▼
                 ┌─────────────────────┐
                 │     CLOUDFLARE      │
                 │                     │
                 │ DNS                 │
                 │ TLS                 │
                 │ WAF                 │
                 │ DDoS protection     │
                 │ Edge rate limits    │
                 └──────────┬──────────┘
                            │
              ┌─────────────┴──────────────┐
              │                            │
              ▼                            ▼
      ┌─────────────────┐          ┌─────────────────┐
      │     VERCEL      │          │ RAILWAY BACKEND │
      │                 │          │                 │
      │ Ghost Web App   │ ─HTTPS─► │ Authentication  │
      │ Frontend        │          │ Authorization   │
      │ Static assets   │          │ Validation      │
      └─────────────────┘          │ Rate limiting   │
                                   │ Security headers│
                                   │ Audit logging   │
                                   └────────┬────────┘
                                            │ DATABASE_URL
                                            │ (server-side only)
                                            ▼
                                   ┌─────────────────┐
                                   │ RAILWAY         │
                                   │ POSTGRESQL      │
                                   │                 │
                                   │ Users           │
                                   │ Sessions        │
                                   │ Profiles        │
                                   │ User Progress   │
                                   └─────────────────┘


      ┌─────────────────────┐
      │  ELECTRON DESKTOP   │
      │  macOS / Windows    │
      └──────────┬──────────┘
                 │
                 │ HTTPS
                 ▼
          Cloudflare → Railway Backend API
```

### Critical trust path

```
Browser/Electron
        |
      HTTPS
        |
   Cloudflare
        |
 Railway Backend API
        |
 Railway PostgreSQL
```

**Neither the browser nor Electron may communicate directly with PostgreSQL.**

Database credentials and server secrets must never be shipped to either client. On Railway, `DATABASE_URL` stays on the backend service only.

---

## Trust boundaries

### Browser trust boundary

- The web client is untrusted code running in the user's browser.
- It may hold only public configuration (for example `API_PUBLIC_URL`).
- It must not receive database URLs, password-hashing secrets, or signing secrets.
- All private reads/writes go through the backend API over HTTPS.
- Identity for authorization must come from server-validated session/access credentials, never from a client-supplied `user_id` alone.

### Electron trust boundary

Electron has two zones:

1. **Renderer (untrusted relative to the host)**  
   Same application UI as the web client. No Node.js integration. Talks to the backend API over HTTPS only. Must not embed backend secrets.

2. **Preload / main (privileged desktop surface)**  
   Minimal IPC bridge only (today: OAuth open + deep-link callback). Renderer must not receive Node primitives. Main process validates IPC inputs and restricts navigation / external URL opens.

Desktop packaging must continue to enforce context isolation, disabled `nodeIntegration`, sandboxing, and restrictive navigation.

### Backend trust boundary

- The backend API is the only application component allowed to authenticate users, authorize ownership, and query PostgreSQL.
- It validates input, enforces rate limits, applies security headers, and returns safe errors (no stack traces or secrets).
- Session/access authenticity is established server-side.

### Database trust boundary

- PostgreSQL stores users, sessions, profiles, and progress.
- Phase 2 schema enforces foreign keys and `ON DELETE CASCADE` ownership from `users` to child tables.
- Least-privilege database roles are documented and recommended (see `docs/SECURITY.md`); enforcement depends on deployment.
- Clients never obtain direct database credentials. `DATABASE_URL` exists only in backend server environment.

### Cloudflare edge boundary

- Planned edge layer for DNS, TLS termination, WAF, DDoS protection, and edge rate limiting.
- Origin (backend) should be protected so traffic preferably arrives through Cloudflare (documented in later production phases).

### Vercel frontend role

- Host the static/web Ghost Protocol client and assets.
- Environment variables for the frontend must be non-secret (public API base URL only).
- Vercel does **not** hold database credentials or auth signing secrets for this architecture.

### Backend API role

- **Implemented (Phase 2):** process health; optional DB connectivity probe; migration tooling; parameterized SQL access layer.
- **Planned:** authentication and session lifecycle; authorization / user-owned resource isolation; profile and progress APIs; validation; rate limiting; production CORS; audit/security logging.

### PostgreSQL role

- Durable storage for `User`, `Session`, `Profile`, and `User Progress`.
- Source of truth for cloud-synced progress for authenticated clients.
- Local `localStorage` on clients remains a cache/offline convenience, not an authorization authority.

---

## Repository layout (Phase 5)

```
/
├── docs/                 # Architecture and security documentation
├── backend/              # Auth + /me profile/progress APIs
│   ├── migrations/       # First-party SQL migrations
│   ├── src/              # API server
│   └── tests/
├── electron/             # Desktop shell + secure preload bridge
├── index.html            # Learning UI (unchanged content; auth via bundle)
├── src/                  # api.js + auth.js (bundled to assets/auth.bundle.js)
├── tests/client/         # UNIT client API/auth migration tests
├── assets/               # Static assets + auth.bundle.js
└── supabase/             # LEGACY/HISTORICAL schema notes only
```

Frontend relocation into `/frontend` is deferred so root `npm start` remains unchanged.

---

## Explicit non-goals (still true)

- No Railway / Vercel / Cloudflare deployment in this phase.
- No Google OAuth or password-reset backend.
- No multi-tenant / company model.
- No OS keychain refresh storage yet (userData IPC bridge is temporary durable storage).
