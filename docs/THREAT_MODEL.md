# Ghost Protocol Threat Model

Status: Phase 1 planning document. Mitigations labeled **planned** are not implemented yet unless also listed under current Electron controls in `SECURITY.md`.

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
- **Planned mitigations:** Secure client storage choices when wiring web/Electron; short TTLs tuned for UX.
- **Current:** Short-lived JWT access tokens; refresh rotation; logout revocation; TLS required in production DB path.

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
- **Current:** Backend ownership for profile/progress is implemented. Legacy Electron still uses Supabase + client-supplied `user_id` until Phase 5 migration.

### Injection

- **Threat:** SQL/command injection via API inputs.
- **Mitigations:** Parameterized queries, profile/progress validation, no dynamic SQL from user strings.
- **Current:** Backend `query` helper requires parameterized values; profile/progress validators reject unknown keys and unsafe shapes.

### Malicious IPC input

- **Threat:** Compromised/rogue renderer invokes preload/main with dangerous URLs or payloads.
- **Planned mitigations:** Keep IPC minimal; validate types/URLs in main; deny unexpected channels; sender checks where practical.
- **Current:** OAuth URL host allowlist and auth deep-link filtering exist; further hardening planned.

### Unsafe external navigation

- **Threat:** App opens malicious external URLs or navigates renderer to attacker content.
- **Planned mitigations:** Restrict `openExternal` allowlists; keep navigation locks; block webviews.
- **Current:** Navigation locked; any `https:` may be opened externally from window-open handler (tighten later).

### Secret leakage

- **Threat:** DB URLs, signing secrets, or service keys shipped in Electron/web bundles or committed to git.
- **Planned mitigations:** Secrets only on backend; `.env` gitignored; `.env.example` placeholders only; CI secret scanning later.
- **Current:** Strengthened `.gitignore`; no first-party backend secrets yet. Legacy Supabase publishable key remains in client source by prior design.

### Database compromise

- **Threat:** Attacker obtains DB credentials or dumps tables.
- **Planned mitigations:** Least-privilege roles, network restrictions, encrypted transport, hashed passwords (Argon2id), limited secrets in DB, backups access control.
- **Current:** No first-party PostgreSQL deployment in this repo phase.

### Progress tampering

- **Threat:** Client forges XP/solved missions and syncs false progress; or overwrites another user's progress.
- **Planned mitigations:** Authenticated user-scoped progress API; server rejects cross-user writes; consider server-side validation bounds; treat localStorage as non-authoritative cache.
- **Current:** Local progress is fully client-controlled; cloud sync trusted the authenticated Supabase subject via RLS when available.

---

## RESIDUAL RISKS (HONEST)

- Until the backend replaces Supabase, cloud authentication/sync remains unavailable and outside first-party control.
- Monolithic inline scripts limit CSP strength.
- Desktop and web clients can always manipulate local progress offline; integrity guarantees apply to **server-stored** progress after Phase 4+.
