# Ghost Protocol Security

This document describes security controls for Ghost Protocol.

**Important:** Planned controls are design intent only. Do not treat planned items as implemented.

Ghost Protocol is **single-user-scoped** (not multi-tenant). Authorization is based on the authenticated user owning their sessions, profile, and progress.

---

## CURRENTLY IMPLEMENTED

Evidence is limited to the existing Electron desktop application and client code in the repository baseline.

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

---

## PLANNED

None of the following backend/edge controls are implemented in Phase 1.

### Authentication (planned)

- Argon2id password hashing
- Short-lived access authentication
- Refresh / session rotation
- Session revocation and logout invalidation
- Password reset with safe, time-limited tokens
- Brute-force / credential-stuffing protections
- Safe authentication error responses (no user enumeration beyond carefully chosen messages)

### Authorization (planned)

- Server-derived user identity from validated credentials/session
- Never trust client-supplied `user_id` for ownership decisions
- Explicit ownership checks on every private profile/progress operation
- Cross-user isolation verified by automated tests

### API hardening (planned)

- Input validation
- Request size limits
- Rate limiting
- Centralized error handling (no stack traces or secrets to clients)
- Strict production CORS
- Security headers
- Audit / security logging

### Database (planned)

- First-party PostgreSQL with migrations
- Foreign keys, unique constraints, indexes
- User ownership constraints
- Least-privilege database access roles
- No direct client → PostgreSQL connectivity

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

- Phase 1 backend scaffolding does **not** provide authentication or authorization.
- Presence of `backend/` directories does **not** mean the API is production-ready.
- Legacy Supabase publishable keys in client bundles are not database passwords; they also do not satisfy the target architecture (clients must not talk to the data plane directly).
