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

- `beginOAuth(url)`
- `onAuthCallback(callback)`

Node primitives are not exposed to the renderer.

### Navigation and window restrictions

- Off-document navigation is blocked (`will-navigate`).
- `window.open` / new windows are denied; `https:` URLs may be opened via `shell.openExternal`.
- Webview attachment is prevented.

### Custom protocol validation

- Scheme: `ghost-protocol`
- Auth callbacks accepted only when protocol and hostname match expected auth callback shape before forwarding to the renderer.
- OAuth launch IPC allowlists `https:` and a specific hostname before `openExternal`.

### Content Security Policy (Electron session)

A CSP header is injected for the desktop session. It restricts default sources and limits `connect-src` to self plus the legacy Supabase hosts.  
Note: `script-src` currently allows `'unsafe-inline'` because the UI is a monolithic inline script in `index.html`.

### Client-side session handling (legacy Supabase path)

- PKCE OAuth flow.
- Session persistence and auto-refresh via Supabase client (when the project is reachable).
- Session restore attempts `getUser()` validation before accepting a cached session.

### Legacy database policies (Supabase migration file)

The retained SQL migration defines row-level security policies intended to restrict `profiles` and `user_progress` to the owning user. Those policies apply only while using Supabase and are **not** a substitute for the planned backend authorization model.

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
- Refresh-token rotation (used refresh token session is revoked; new session issued)
- Logout revokes the corresponding server-side session
- Central `requireAuth` middleware derives `req.auth.userId` from verified access tokens only
- Safe auth error responses (no password hashes, tokens, SQL, or stack traces)
- In-process rate limiting on auth endpoints; does not trust `X-Forwarded-For` unless `TRUST_PROXY=true`
- Production startup requires `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` (≥32 chars)

**Non-claim:** Electron/web clients are **not** wired to these endpoints yet. Legacy Supabase auth remains in the desktop app.  
**Non-claim:** Google OAuth, password reset emails, and distributed/edge rate limits are **not** implemented.

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
- Google OAuth (desktop deep-link + web redirect)
- Email verification workflow
- Distributed / Cloudflare edge rate limiting and bot protections
- Client migration off Supabase onto these backend endpoints

### Authorization (planned / remaining)

- Profile and progress ownership endpoints (Phase 4)
- Cross-user isolation tests against live PostgreSQL
- Broader API authorization beyond `/auth/me`

### API hardening (planned)

- Input validation
- Request size limits
- Rate limiting
- Centralized error handling (no stack traces or secrets to clients)
- Strict production CORS
- Security headers
- Audit / security logging

### Database (planned / remaining)

- Operational enforcement of least-privilege roles in each hosting environment
- Automated integration testing against CI PostgreSQL
- No direct client → PostgreSQL connectivity remains a hard rule (clients still use legacy Supabase until later phases)

### Clients (planned hardening / migration)

- Replace direct Supabase access with HTTPS calls to the backend API
- Environment-based public API URL only in browser/Electron bundles
- Keep Electron isolation controls; update CSP/`connect-src` and OAuth allowlists to the new API/IdP hosts
- Add default-deny permission request handling
- Tighten external URL allowlisting where practical
- Web CSP via hosting headers (Vercel / Cloudflare)

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

- Phase 3 authentication is backend-only and **not** connected to Electron/web UI yet.
- Presence of auth endpoints does **not** mean production is deployed on Railway.
- Legacy Supabase client code remains until an explicit client migration phase.
- In-process rate limiting is a foundation, not a complete abuse-prevention system.
