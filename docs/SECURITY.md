# Ghost Protocol Security

This document describes security controls for Ghost Protocol.

**Important:** Planned controls are design intent only. Do not treat planned items as implemented. Platform-dependent claims are labeled honestly.

**Production status (Phase 8 ops + Phase 9 WP1):** Web and API are deployed (Vercel `https://ghost-protocol-pi.vercel.app`, Railway `https://ghost-protocol-production-f7ef.up.railway.app`). Email/password and Google OAuth are implemented and operator-verified. This does **not** imply public Electron distribution readiness — see residual risks and `docs/PHASE-9-AUDIT.md`.

Ghost Protocol is **single-user-scoped** (not multi-tenant). Authorization is based on the authenticated user owning their sessions, profile, and progress.

---

## CURRENTLY IMPLEMENTED

### Electron renderer process hardening

| Control | Value / behavior |
|---------|------------------|
| `contextIsolation` | `true` |
| `nodeIntegration` | `false` |
| `sandbox` | `true` |
| `webSecurity` | `true` |
| `allowRunningInsecureContent` | `false` |
| `webviewTag` | `false` |
| `nodeIntegrationInWorker` | `false` |
| `nodeIntegrationInSubFrames` | `false` |
| `experimentalFeatures` | `false` |
| Production DevTools | Disabled when packaged (`devTools: !app.isPackaged`) |

DevTools visibility is **not** a security boundary. Auth remains sound if a user can inspect the renderer.

### Minimal preload surface

`electron/preload.cjs` exposes only a frozen `window.ghostDesktop` object with:

- `apiBaseUrl` (public API base; sync, config-driven)
- `authSession.store` / `authSession.load` / `authSession.clear` (opaque string IPC only)
- `beginOAuth(url)` / `onAuthCallback(callback)` (Google OAuth start via allowlisted HTTPS API `/auth/google` URL + `ghost-protocol://auth/callback` deep link)

Node primitives and filesystem APIs are not exposed. Token values are never logged.

### Browser / web authentication (Phase 7)

| Control | Behavior |
|---------|----------|
| Access token | Memory-only |
| Refresh token | Memory-only (no `localStorage` / `sessionStorage` persistence) |
| Public API URL | `window.GHOST_API_BASE_URL` / Electron `ghostDesktop.apiBaseUrl` only |
| Server secrets in web/Vercel | **Forbidden** (`DATABASE_URL`, token secrets) |
| CORS | Backend allowlists `FRONTEND_URL` origins |

Closing a browser tab ends the web session. Stronger browser session strategies remain **PLANNED**.

### IPC allowlist

| Channel | Purpose | Validation |
|---------|---------|------------|
| `auth:get-api-base-sync` | Public API base | Sync config only |
| `auth-session:store` | Persist refresh | Trusted sender; type/length; safeStorage required |
| `auth-session:load` | Load refresh | Trusted sender; decrypt only |
| `auth-session:clear` | Clear refresh | Trusted sender |
| `auth:open-oauth` | Google OAuth start | Trusted sender; HTTPS only; must be allowlisted API `/auth/google` start URL; opens via `shell.openExternal` |
| `auth:callback` | Deep-link event | Main → renderer after strict URL parse |

Semantic credential errors only: `SESSION_UNAVAILABLE`, `SESSION_STORAGE_FAILED` (no tokens, paths, or ciphertext in messages).

### Refresh credential storage (Phase 6)

| Property | Status |
|----------|--------|
| Access token storage | **IMPLEMENTED** — renderer memory only |
| Refresh persistence path | Fixed file under Electron `userData` (renderer cannot choose path) |
| At-rest protection | **IMPLEMENTED** — encrypt with Electron `safeStorage` in **main** before write |
| Plaintext persistent fallback | **NONE** — if secure storage unavailable, prefer non-persistent / re-login |
| Legacy Phase 5 plaintext file | Deleted on sight; migrated to ciphertext only when `safeStorage` is available |
| macOS | **PLATFORM-DEPENDENT** — Electron documents Keychain-backed key material when encryption is available |
| Windows | **PLATFORM-DEPENDENT** — Electron documents DPAPI-backed protection |
| Linux | **PLATFORM-DEPENDENT** — OS secret backends when selected; `basic_text` treated as **unavailable** for persistence |
| Unit tests prove OS Keychain | **NO** — tests use simulated `safeStorage` |

### Navigation and external URL policy

- Off-document navigation denied (`will-navigate` + `shouldAllowInAppNavigation`).
- `window.open` always `{ action: 'deny' }`; allowlisted `https:` URLs may open via `shell.openExternal` after validation (no userinfo; scheme must be `https:`).
- `javascript:`, `data:`, `file:` external opens denied.
- Webview attachment prevented globally.

### Custom protocol validation

- Scheme: `ghost-protocol`
- Accepted shape only: `ghost-protocol://auth/callback` (+ optional query), max length enforced
- Rejects wrong host/path, userinfo, ports, malformed URLs
- Forwarding a callback **does not** authenticate the user; renderer must complete exchange with the API
- Google OAuth is **IMPLEMENTED** (web redirect + Electron `openExternal` + deep-link callback). **H1** Google email auto-link: **fixed in code** (`findOrCreateGoogleUser` refuses email-only attach; neutral `account_conflict`) — **pending production verification**; see `docs/PHASE-9-AUDIT.md`

### Content Security Policy (Electron session)

Injected CSP (no `unsafe-eval`):

- `default-src 'self'`
- `script-src 'self' 'unsafe-inline'` — required for monolithic `index.html` inline scripts
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
- `font-src 'self' https://fonts.gstatic.com`
- `img-src 'self' data: https:`
- `connect-src` — `'self'` + configured API base (plus loopback aliases when API is local)
- `object-src` / `frame-src` / `frame-ancestors` / `worker-src` / `child-src` — `'none'`
- `base-uri` / `form-action` — `'none'`

### API transport

- Production / remote API URLs must be `https:`
- Loopback `http://127.0.0.1` / `http://localhost` allowed for explicit local development
- Remote `http://` fails closed at Electron startup

### Client-side session handling

- Single in-flight refresh promise coordinates concurrent 401s
- Session restore: encrypted refresh → `POST /auth/refresh` → `GET /auth/me` → profile/progress
- Logout: best-effort `POST /auth/logout`, then always clear local tokens

### Packaging

- `asar: true`
- macOS `hardenedRuntime: true` in electron-builder config  
  (**H2**) Public distribution signing/notarization credentials are **not** configured in-repo — **NO-GO for public Electron distribution**.

### Backend (Phases 2–7+) — summary

- Argon2id passwords; JWT access; hashed refresh + family reuse revocation
- Google OAuth (server routes + client web/Electron flows); password reset still absent
- `/me/*` ownership from `req.auth.userId` only
- Parameterized SQL; sanitized errors; production config gates
- See prior sections / backend README for endpoint detail

### Legacy database policies (Supabase migration file)

The retained SQL under `supabase/` is **LEGACY/HISTORICAL**. It is not used by the Electron runtime.

---

## PLANNED

- Password reset with safe, time-limited tokens
- Email verification workflow (register still creates unverified password users)
- Explicit authenticated Google account linking UI (after H1 conflict path; not auto-link)
- Google ID token JWKS verification + safer exchange delivery (Phase 9 WP3)
- Optimistic concurrency for progress sync (**WAL-251** — required before concurrent multi-device sync *claims*)
- Distributed / Cloudflare edge rate limiting and bot protections
- Broader API surfaces beyond `/me/*` as features grow
- Web CSP via hosting **response headers** (meta CSP exists today; header still planned — Phase 9 WP5)
- Cloudflare DNS / WAF in front of API
- Electron signing / notarization (Phase 10) and CVE triage (Phase 9 WP6 / **H3**)
- Reduce `'unsafe-inline'` when the learning UI is no longer a monolithic inline script
- Optional CI PostgreSQL cross-user isolation suite

---

## Residual risks (Phase 9 register summary)

Full register: `docs/PHASE-9-AUDIT.md`. Approved position: **Conditional GO** for private testing / portfolio / controlled demos; **NO-GO** public Electron; **NO-GO** conflict-safe concurrent multi-device sync claims.

| ID | Risk | Status |
|----|------|--------|
| H1 | Google email auto-link pre-hijack | Fixed in code — pending production verification |
| H2 | Unsigned / not-notarized Electron | Open — blocks public desktop |
| H3 | Electron / root npm audit High CVEs | Open — blocks wide public desktop |
| M1 / WAL-251 | Full-snapshot LWW progress | Claims blocker; sequential use accepted |
| M3 | In-process rate limits | Accepted residual at current scale |
| M4–M6 | OAuth JWKS / query exchange / web CSP header | Deferred WP3/WP5 |
| M7–M9 | Client XP trust / soft unlock / password-reset stub | Accepted residuals (honesty) |

---

## Explicit non-claims

- Deployed Vercel/Railway + working Google OAuth do **not** mean public Electron distribution is safe (**H2**, **H3**).
- Supabase runtime is removed from the Electron client; `supabase/` SQL remains historical only.
- Unit tests with mocked `safeStorage` do **not** prove OS Keychain/DPAPI behavior.
- Password reset is **not** implemented (UI stub only).
- Progress sync is **not** conflict-safe under concurrent multi-device edits until WAL-251.
- In-process rate limiting is a foundation, not a complete abuse-prevention system.
- Hiding DevTools is **not** a security boundary.
