# Ghost Protocol Architecture

Status: Phase 2 data foundation in progress. This document describes the **current** runtime system, what Phase 2 has **implemented** in `backend/`, and the **target** system. Items marked planned are not implemented yet.

Ghost Protocol is a single-user-scoped learning application (not multi-tenant). Private resources are owned by the authenticated user:

```
User
  ├── Session
  ├── Profile
  └── Progress
```

---

## Current architecture (Phase 0 / baseline)

```
┌──────────────────────────────────────────────────────────────────┐
│                     ELECTRON DESKTOP APP                         │
│  main → preload → renderer (index.html + auth.bundle.js)         │
│  localStorage progress + optional Supabase sync                  │
└───────────────────────────────┬──────────────────────────────────┘
                                │ HTTPS (client SDK)
                                ▼
                 ┌──────────────────────────────┐
                 │  SUPABASE (UNREACHABLE)      │
                 │  Auth + PostgREST            │
                 │  profiles / user_progress    │
                 └──────────────────────────────┘
```

The Electron desktop app still talks directly to Supabase (when reachable). That pattern will be replaced in later phases.

### Phase 2 backend (implemented, not wired to clients)

The `backend/` package now includes:

- PostgreSQL connection pool via `pg` (server-side only; `DATABASE_URL` from environment)
- Deterministic SQL migrations for `users`, `sessions`, `profiles`, `user_progress`
- Migration runner (`npm run db:migrate`, `npm run db:status`)
- `GET /health` and `GET /health/db` (db health returns only ok/unavailable)
- Railway-oriented process readiness: `PORT`/`HOST` bind, production config gate, graceful pool shutdown

There is still **no** authentication API, **no** profile/progress API, **no** live Railway/Vercel/Cloudflare deployment, and **no** Electron/web client connection to this backend.

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

- Durable storage for `User`, `Session`, `Profile`, and `User Progress` (schema implemented in Phase 2 migrations).
- Source of truth for cloud-synced progress once auth + APIs are online (later phases).
- Local `localStorage` on clients may remain a cache/offline convenience, not an authorization authority.

---

## Repository layout (Phase 2)

```
/
├── docs/                 # Architecture and security documentation
├── backend/              # PostgreSQL foundation + health endpoints (not wired to clients)
│   ├── migrations/       # First-party SQL migrations
│   ├── src/db/           # Pool, query helper, migration runner
│   └── tests/
├── electron/             # Existing desktop shell (unchanged)
├── index.html            # Existing UI (unchanged)
├── src/                  # Existing auth source (unchanged)
├── assets/               # Existing static assets (unchanged)
└── supabase/             # Legacy schema notes (retained until client migration)
```

Frontend relocation into `/frontend` is deferred so root `npm start` remains unchanged.

---

## Explicit non-goals (still true after Phase 2)

- No authentication implementation in the new backend.
- No client wiring to the new backend.
- No removal of Supabase client code.
- No Electron or UI changes.
- No multi-tenant / company model.
