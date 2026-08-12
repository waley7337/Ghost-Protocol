# Ghost Protocol Threat Model

Status: Phase 6 Electron hardening reflected. Mitigations labeled **planned** are not implemented yet unless also listed under current controls in `SECURITY.md`.

Scope: single-user-scoped Ghost Protocol (User → Session / Profile / Progress). No company/tenant isolation model.

---

## ASSETS

| Asset | Why it matters |
|-------|----------------|
| Credentials (passwords / OAuth linkage) | Account takeover |
| Sessions (access + refresh/session tokens) | Impersonation without password |
| User profile | PII and account metadata |
| Progress data | Integrity of learning state / XP / completions |
| Backend secrets | Token signing keys, DB credentials, encryption material |
| Database | Authoritative store for users, sessions, profiles, progress |
| Electron privileged APIs (main/preload) | Host-level abuse if renderer escapes isolation |

---

## TRUST BOUNDARIES

```
Internet ──► Cloudflare ──► Backend API ──► PostgreSQL

Browser ──HTTPS──► API
Electron renderer ──HTTPS──► API
Renderer ──IPC──► preload/main
```

| Boundary | Trust assumption |
|----------|------------------|
| Internet → Cloudflare | Untrusted traffic; edge filters abuse |
| Cloudflare → API | Prefer origin only receiving edge-filtered traffic (planned) |
| Browser → API | Browser is hostile; authenticate and authorize every private call |
| Electron renderer → API | Renderer is untrusted like a browser regarding secrets and authz |
| Renderer → preload/main | IPC must be minimal and input-validated |
| API → PostgreSQL | Only API holds DB credentials; queries are parameterized |

**Hard rule:** Browser and Electron must never connect directly to PostgreSQL.

---

## THREATS AND MITIGATIONS

### Credential stuffing

- **Threat:** Attackers try leaked email/password pairs at scale.
- **Planned mitigations:** Cloudflare/edge rate limits, monitoring/audit logs, optional bot protections.
- **Current:** In-process auth rate limiting foundation on register/login/refresh; generic invalid-credential errors.

### Brute force

- **Threat:** Online password guessing against login endpoints.
- **Planned mitigations:** Edge rate limits; stronger lockout/backoff policies as needed.
- **Current:** Argon2id hashing; per-IP in-process rate limit; generic login errors; dummy verify work on unknown users.

### Session theft

- **Threat:** Stolen access tokens/cookies used by an attacker.
- **Current:** Short-lived JWT access tokens (memory-only in renderer); refresh rotation; logout revocation; refresh at rest encrypted via Electron `safeStorage` when available (PLATFORM-DEPENDENT); TLS required in production DB path.
- **Planned mitigations:** Short TTLs tuned for UX; web secure storage choices when wiring hosted web client.

### Refresh-token reuse

- **Threat:** Stolen refresh/session token replayed after rotation.
- **Planned mitigations:** Edge anomaly detection; optional stricter device binding.
- **Current:** Refresh rotation marks `replaced_by_session_id`. Re-presentation of a replaced credential revokes the whole `family_id` chain, then returns a generic unauthorized error. New logins create a new family.

### XSS

- **Threat:** Script injection in renderer/web UI steals session material or drives IPC/API calls.
- **Planned mitigations:** Strong CSP (reduce `'unsafe-inline'` over time), output encoding, dependency hygiene, security headers on web responses.
- **Current:** Electron CSP present but allows `'unsafe-inline'` scripts due to monolithic `index.html`; UI largely uses escaping helpers in places.

### CSRF (where applicable)

- **Threat:** Cross-site requests perform state-changing actions using browser-sent credentials.
- **Planned mitigations:** If cookie-based sessions are used, require CSRF defenses or same-site cookie strategy plus CORS restrictions. If Authorization headers from non-simple requests are used, document CSRF residual risk carefully.
- **Current:** N/A for first-party API (not built). Desktop app is not a classic CSRF browser origin, but web deployment will be.

### Broken object-level authorization (BOLA)

- **Threat:** Client supplies another user's id and reads/writes their profile or progress.
- **Mitigations (Phase 4):** Server-derived identity (`req.auth.userId`); every `/me/profile` and `/me/progress` query scoped to that id; client `user_id` / `userId` / `id` fields are stripped or ignored; automated cross-user isolation tests on the memory pool.
- **Current:** Backend ownership for profile/progress is implemented. Phase 5 Electron client calls `/me/*` with Bearer access tokens and never treats client `user_id` as authoritative.

### Injection

- **Threat:** SQL/command injection via API inputs.
- **Mitigations:** Parameterized queries, profile/progress validation, no dynamic SQL from user strings.
- **Current:** Backend `query` helper requires parameterized values; profile/progress validators reject unknown keys and unsafe shapes.

### Malicious IPC input

- **Threat:** Compromised/rogue renderer invokes preload/main with dangerous URLs or payloads.
- **Current (Phase 6):** Explicit IPC allowlist; trusted-sender checks; typed/length-limited credential IPC; semantic `SESSION_*` errors; OAuth open denied (not configured); strict auth deep-link parsing.
- **Planned:** Keep IPC minimal as features grow; deny unexpected channels.

### Unsafe external navigation

- **Threat:** App opens malicious external URLs or navigates renderer to attacker content.
- **Current (Phase 6):** Navigation locked to same document URL; `window.open` denied; `openExternal` only after `https:` allowlist validation (no credentials in URL).
- **Planned:** Further host allowlisting if product needs tighter egress.

### Secret leakage

- **Threat:** DB URLs, signing secrets, or service keys shipped in Electron/web bundles or committed to git.
- **Planned mitigations:** Secrets only on backend; `.env` gitignored; `.env.example` placeholders only; CI secret scanning later.
- **Current:** Strengthened `.gitignore`; backend secrets stay server-side. Electron ships only a public API base URL. Supabase publishable key removed from runtime.

### Database compromise

- **Threat:** Attacker obtains DB credentials or dumps tables.
- **Planned mitigations:** Least-privilege roles, network restrictions, encrypted transport, hashed passwords (Argon2id), limited secrets in DB, backups access control.
- **Current:** No first-party PostgreSQL deployment in this repo phase.

### Progress tampering

- **Threat:** Client forges XP/solved missions and syncs false progress; or overwrites another user's progress.
- **Planned mitigations:** Authenticated user-scoped progress API; server rejects cross-user writes; consider server-side validation bounds; treat localStorage as non-authoritative cache.
- **Current:** Local progress remains a cache; authenticated `PUT /me/progress` stores server-side progress scoped to `req.auth.userId`. Startup sync barrier avoids overwriting server progress with pre-auth local events.

---

## RESIDUAL RISKS (HONEST)

- Refresh at-rest protection depends on Electron `safeStorage` availability and platform backend quality (Linux `basic_text` is rejected; other backends are PLATFORM-DEPENDENT).
- Monolithic inline scripts require CSP `'unsafe-inline'` for scripts/styles.
- Desktop and web clients can always manipulate local progress offline; integrity guarantees apply to **server-stored** progress.
- Backend/API hosting is not deployed to Railway/Cloudflare/Vercel in this phase.
- Windows DPAPI does not isolate secrets from other apps in the same user session (per Electron/Windows model).
