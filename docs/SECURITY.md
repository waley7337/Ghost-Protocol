# Ghost Protocol Security

This document describes security controls for Ghost Protocol.

**Important:** Planned controls are design intent only. Do not treat planned items as implemented.

Ghost Protocol is **single-user-scoped** (not multi-tenant). Authorization is based on the authenticated user owning their sessions, profile, and progress.

---

## CURRENTLY IMPLEMENTED

### Electron / legacy client controls

Evidence below includes the existing Electron desktop application and client code in the repository baseline, plus Phase 2 backend data-foundation controls that do **not** yet include authentication.

### Electron renderer process hardening

| Control | Value / behavior |
|---------|------------------|
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| `webSecurity` | `true` |
| `allowRunningInsecureContent` | `false` |
| Production DevTools | Disabled when packaged (`devTools: !app.isPackaged`) |

### Minimal preload surface

`electron/preload.cjs` exposes only a frozen `window.ghostDesktop` object with:

- `apiBaseUrl` (public API base; sync, config-driven)
- `beginOAuth(url)` / `onAuthCallback(callback)` (deep-link architecture retained; OAuth provider not configured)
- `getRefreshToken` / `setRefreshToken` / `clearRefreshToken` (opaque string IPC only)

Node primitives and filesystem APIs are not exposed to the renderer. Token values are never logged.
### Navigation and window restrictions

- Off-document navigation is blocked (`will-navigate`).
- `window.open` / new windows are denied; `https:` URLs may be opened via `shell.openExternal`.
- Webview attachment is prevented.

### Custom protocol validation

- Scheme: `ghost-protocol`
- Auth callbacks accepted only when protocol and hostname match expected auth callback shape before forwarding to the renderer.
- OAuth launch IPC requires `https:` but **rejects all launches** until a Phase 6 provider allowlist is configured (Google OAuth not implemented).

### Content Security Policy (Electron session)

A CSP header is injected for the desktop session. It restricts default sources and limits `connect-src` to `'self'` plus the configured Ghost Protocol API base URL (default local API). Supabase hosts are **not** in the allowlist.  
Note: `script-src` currently allows `'unsafe-inline'` because the UI is a monolithic inline script in `index.html`.

### Client-side session handling (Phase 5 backend API)

- Access tokens: **in-memory only** in the renderer (not written to localStorage).
- Refresh tokens: persisted via Electron main-process bridge to a `userData` file (mode `0600`). **Not** OS keychain yet (PLANNED Phase 6). Non-Electron fallback is memory-only.
- Single in-flight refresh promise coordinates concurrent 401s (avoids refresh-family reuse revocation races).
- Session restore: stored refresh → `POST /auth/refresh` → `GET /auth/me` → profile/progress; otherwise auth gate (no stale local impersonation).
- Logout: best-effort `POST /auth/logout`, then always clear local tokens.

### Legacy database policies (Supabase migration file)

The retained SQL under `supabase/` is **LEGACY/HISTORICAL**. It is not used by the Electron runtime. Backend authorization uses `req.auth.userId`, not Supabase RLS.
### Packaging

- `asar: true`
- macOS `hardenedRuntime: true` in electron-builder config  
  (public distribution signing/notarization credentials are not configured in-repo).

### Backend PostgreSQL foundation (Phase 2)

- Official `pg` driver only (no ORM)
- `DATABASE_URL` read from server environment/config only
- Connection pool with explicit TLS controls (production defaults to TLS; certificate validation remains enabled by default)
- Optional `DATABASE_SSL_CA` for trusting a provided CA without disabling validation
- Parameterized query helper; database errors sanitized (no connection strings/credentials in thrown API-facing errors)
- SQL migrations for `users`, `sessions`, `profiles`, `user_progress` with foreign keys and ownership cascade
- `sessions.refresh_token_hash` column prepared for hashed session credentials (plaintext refresh tokens are not stored by schema design)
- `GET /health/db` returns only `{ "status": "ok" }` or `{ "status": "unavailable" }`
- Railway process readiness: listen on injected `PORT`, bind `0.0.0.0`, fail closed on invalid production config, close pool on shutdown

**Non-claim:** Creating a `sessions` table does **not** mean session authentication, rotation, or revocation logic is implemented.  
**Non-claim:** Railway readiness docs/code do **not** mean a Railway project has been deployed.

### Backend authentication foundation (Phase 3)

- Argon2id password hashing (`argon2` library)
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- Short-lived JWT access tokens (`jose`, HS256) with explicit issuer, audience, and expiration checks
- Refresh tokens stored only as HMAC-SHA256 hashes in `sessions.refresh_token_hash`
- Refresh-token rotation with `family_id` / `replaced_by_session_id` linkage
- Reuse of a replaced refresh credential revokes the entire refresh-token family, then fails generically
- Rotation uses PostgreSQL transactions + `SELECT ... FOR UPDATE` (and one-active-session-per-family unique index)
- Logout revokes the current session only (does not wipe unrelated login families)
- Central `requireAuth` middleware derives `req.auth.userId` from verified access tokens only
- Safe auth error responses (no password hashes, tokens, SQL, or stack traces)
- In-process rate limiting on auth endpoints; does not trust `X-Forwarded-For` unless `TRUST_PROXY=true`
- Production startup requires `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` (≥32 chars)

**Non-claim:** Google OAuth, password reset emails, and distributed/edge rate limits are **not** implemented.  
**Non-claim:** Railway/Vercel/Cloudflare are **not** deployed from this phase.

### User-scoped profile + progress API (Phase 4) + client wiring (Phase 5)

- `GET /me/profile`, `PUT /me/profile`
- `GET /me/progress`, `PUT /me/progress`
- **CLIENT OWNERSHIP IDENTIFIERS ARE NEVER AUTHORITATIVE.** All ownership uses `req.auth.userId` from verified access tokens.
- Profile field allowlist: `name`, `avatarUrl`
- Progress payload validation for GhostProgress shape (types, bounds, size)
- Parameterized SQL with `WHERE user_id = $authenticatedUserId`
- `GET /me/progress` returns `404` / `progress_not_found` when no server row exists
- Electron client hydrates server progress when present; otherwise uploads local snapshot. Startup sync barrier prevents pre-hydrate uploads from overwriting server progress.
### PostgreSQL privilege model (documented intent)

Ideal separation:

```
MIGRATION ROLE
    │
    └── schema modification (DDL), owns migrations

APPLICATION ROLE
    │
    └── required DML only on users/sessions/profiles/user_progress
```

The runtime API role must **not** be a PostgreSQL superuser, must **not** be the database owner when avoidable, and must **not** be the migration administrator.

Practical hosted fallback: many managed PostgreSQL providers issue a single powerful user. In that case:

1. Prefer creating a dedicated app role with table DML grants only after migrations.
2. If the provider cannot separate roles, document the residual risk and restrict network access to the database (private network / allowlisted backend only).
3. Never embed the database URL in Electron or web clients regardless of role model.

---

## PLANNED

The following controls remain unimplemented.

### Authentication (planned / remaining)

- Password reset with safe, time-limited tokens
- Google OAuth (desktop deep-link + web redirect) — UI currently hidden
- Email verification workflow
- Distributed / Cloudflare edge rate limiting and bot protections
- OS keychain (or equivalent) for refresh-token persistence

### Authorization (planned / remaining)

- Broader API surfaces beyond `/me/*` as features grow
- Optional CI PostgreSQL cross-user isolation suite (unit isolation tests already cover memory pool)

### API hardening (planned)

- Distributed / edge rate limiting
- Strict production CORS
- Security headers
- Audit / security logging
- Broader input validation beyond auth + profile/progress

### Database (planned / remaining)

- Operational enforcement of least-privilege roles in each hosting environment
- Automated integration testing against CI PostgreSQL
- No direct client → PostgreSQL connectivity remains a hard rule

### Clients (planned hardening)

- Upgrade refresh persistence from userData file to OS keychain
- Add default-deny permission request handling
- Tighten external URL allowlisting where practical
- Web CSP via hosting headers (Vercel / Cloudflare)
- Production API URL / packaging for hosted backends
### Edge / production (planned)

- Cloudflare DNS, TLS, WAF, DDoS protection
- Edge rate-limit strategy
- Origin protection strategy (documented and applied in production phases)

### Verification (planned)

- Authentication, session, authorization/ownership, and validation tests
- Electron security configuration checks where practical
- CI: lint, tests, build, security-sensitive checks

---

## Explicit non-claims

- Presence of auth endpoints / local client wiring does **not** mean production is deployed on Railway.
- Supabase runtime is removed from the Electron client; `supabase/` SQL remains historical only.
- Refresh persistence uses a main-process userData file, **not** OS keychain.
- Google OAuth and password reset are **not** implemented.
- In-process rate limiting is a foundation, not a complete abuse-prevention system.
