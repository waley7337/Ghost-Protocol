# Ghost Protocol Security

This document describes security controls for Ghost Protocol.

**Important:** Planned controls are design intent only. Do not treat planned items as implemented. Platform-dependent claims are labeled honestly.

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
- `beginOAuth(url)` / `onAuthCallback(callback)` (deep-link architecture retained; OAuth **not** configured — launches rejected)

Node primitives and filesystem APIs are not exposed. Token values are never logged.

### IPC allowlist

| Channel | Purpose | Validation |
|---------|---------|------------|
| `auth:get-api-base-sync` | Public API base | Sync config only |
| `auth-session:store` | Persist refresh | Trusted sender; type/length; safeStorage required |
| `auth-session:load` | Load refresh | Trusted sender; decrypt only |
| `auth-session:clear` | Clear refresh | Trusted sender |
| `auth:open-oauth` | Future OAuth | Trusted sender; HTTPS only; **always rejects** (not configured) |
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
- Forwarding a callback **does not** authenticate the user
- Google OAuth remains **NOT IMPLEMENTED** (protocol prepared but dormant)

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
  (public distribution signing/notarization credentials are not configured in-repo).

### Backend (Phases 2–4) — summary

- Argon2id passwords; JWT access; hashed refresh + family reuse revocation
- `/me/*` ownership from `req.auth.userId` only
- Parameterized SQL; sanitized errors; production config gates
- See prior sections / backend README for endpoint detail

### Legacy database policies (Supabase migration file)

The retained SQL under `supabase/` is **LEGACY/HISTORICAL**. It is not used by the Electron runtime.

---

## PLANNED

- Password reset with safe, time-limited tokens
- Google OAuth (desktop deep-link + web redirect)
- Email verification workflow
- Distributed / Cloudflare edge rate limiting and bot protections
- Broader API surfaces beyond `/me/*` as features grow
- Web CSP via hosting headers (Vercel / Cloudflare)
- Railway / Vercel / Cloudflare production deployment
- Reduce `'unsafe-inline'` when the learning UI is no longer a monolithic inline script
- Optional CI PostgreSQL cross-user isolation suite

---

## Explicit non-claims

- Presence of auth endpoints / local client wiring does **not** mean production is deployed on Railway.
- Supabase runtime is removed from the Electron client; `supabase/` SQL remains historical only.
- Unit tests with mocked `safeStorage` do **not** prove OS Keychain/DPAPI behavior.
- Google OAuth and password reset are **not** implemented.
- In-process rate limiting is a foundation, not a complete abuse-prevention system.
- Hiding DevTools is **not** a security boundary.
