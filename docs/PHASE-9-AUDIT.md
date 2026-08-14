# Phase 9 — Security Audit & Residual-Risk Register

| Meta | Value |
|------|-------|
| Date | 2026-08-14 |
| Linear parent | [WAL-186](https://linear.app/waley-nagdi/issue/WAL-186/09-security-audit-and-release-hardening) |
| WP1 | [WAL-252](https://linear.app/waley-nagdi/issue/WAL-252/wp1-docs-truth-and-residual-risk-register) (documentation truth — this document) |
| Scope | Pre-implementation read-only audit + WP1 documentation truth. **No application code, dependency, auth, or infrastructure changes in WP1.** |
| Honesty labels | `VERIFIED` (repo/tests/audit pass) · `ASSUMED` (Phase 8 ops / prior QA not re-proven in this pass) |

---

## Approved release position

| Decision | Scope |
|----------|--------|
| **Conditional GO** | Private testing, portfolio screenshots, controlled demos |
| **NO-GO** | Public Electron distribution (unsigned / not notarized) |
| **NO-GO** | Claims of conflict-safe concurrent multi-device synchronization ([WAL-251](https://linear.app/waley-nagdi/issue/WAL-251/add-optimistic-concurrency-protection-to-cross-device-progress)) |

Phase 9 remains **In Progress**. Do **not** mark WAL-186 Done after WP1 alone. Do **not** close WAL-251.

---

## Explicit release blockers

| ID | Blocker | Blocks |
|----|---------|--------|
| **H1** | Google email auto-link pre-hijack | Broad Google-auth user acquisition without fix or explicit acceptance |
| **H2** | Unsigned / not-notarized Electron | Public / Gatekeeper-safe macOS (and general public) desktop distribution |
| **H3** | Electron / root `npm audit` High vulnerabilities | Wide public desktop distribution until triaged/upgraded |
| **WAL-251** | Full-snapshot LWW progress sync | **Claims only** of conflict-safe concurrent multi-device sync (implementation deferred; leave Todo) |

**Not blockers for Conditional GO:** sequential single-user sync, password-reset stub, quiz/achievement UI shells, browser memory-only sessions, in-process rate limits (must remain documented residuals).

---

## Production URLs (public, already deployed)

| Surface | URL |
|---------|-----|
| Web | `https://ghost-protocol-pi.vercel.app` |
| API | `https://ghost-protocol-production-f7ef.up.railway.app` |

No secrets in this document. Operator secrets stay on Railway / Google Cloud consoles only.

---

## Audit baseline (pre-implementation)

| Check | Result | Label |
|-------|--------|-------|
| Branch / HEAD at audit | `main` @ `7d80371` (clean) | VERIFIED |
| `npm test` (root) | 69 pass | VERIFIED |
| `npm run lint` | PASS (Electron scope) | VERIFIED |
| `npm --prefix backend test` | 57 pass / 3 skip (no `DATABASE_URL`) | VERIFIED |
| `npm audit` (root) | 0 critical, 5 high, 2 moderate | VERIFIED |
| `npm audit` (backend) | 0 vulnerabilities | VERIFIED |
| Live Railway/Vercel probes this pass | Not re-run | ASSUMED via Phase 8 |

---

## Findings register

Status values for WP1: `Open` · `Documented` · `Accepted residual` · `Claims-blocked` · `Deferred (WP*)`.

### Critical

*None verified.*

---

### High

#### H1 — Google email auto-link pre-hijack

| Field | Detail |
|-------|--------|
| Severity | **High** |
| Component | `backend/src/services/googleOAuth.js` (`findOrCreateGoogleUser` email-match path) |
| Evidence | If an attacker registers `victim@gmail.com` first (`email_verified=FALSE`, password set), then the victim signs in with Google for the same verified email, the server links `google_sub` onto the attacker row and sets `email_verified=TRUE`. Attacker retains password access. |
| Impact | Account pre-hijack for live Google OAuth |
| Remediation | Refuse link when password account is unverified; require password reauth to link; or explicit conflict path — see [WAL-254](https://linear.app/waley-nagdi/issue/WAL-254/wp2-harden-google-email-auto-link-h1) |
| Verification | Expanded `google.oauth.test.js`; disposable-account production retest |
| Status | **Open** — release blocker; WP2 Todo (do not implement in WP1) |

#### H2 — Unsigned / not-notarized Electron

| Field | Detail |
|-------|--------|
| Severity | **High** (public distribution) |
| Component | `package.json` `build.mac` (`hardenedRuntime: true`; no identity/notarize); `docs/SECURITY.md` |
| Evidence | Signing/notarization credentials not configured in-repo |
| Impact | Gatekeeper / public macOS (and honest public desktop) distribution unsafe |
| Remediation | Phase 10 signing/notarization plan with out-of-repo credentials |
| Verification | Signed + notarized artifact smoke; Gatekeeper open on clean Mac |
| Status | **Open** — release blocker for public Electron; Conditional GO for private builds |

#### H3 — Electron dependency audit vulnerabilities

| Field | Detail |
|-------|--------|
| Severity | **High** |
| Component | Root `package.json` / lockfile; Electron `37.x` ships in packaged app |
| Evidence | Pre-implementation `npm audit`: High — `electron`, `brace-expansion`, `extract-zip`, `fast-uri`, `js-yaml`; Moderate — `tar`, `undici`. Backend audit clean. |
| Impact | CVE exposure in desktop runtime / toolchain; blocks wide public desktop release until triaged |
| Remediation | [WAL-257](https://linear.app/waley-nagdi/issue/WAL-257/wp6-electron-dependency-cve-triage-h3) — upgrade plan, no blind `--force`; document sandbox/IPC mitigations |
| Verification | Fresh audit; Electron security suite; packaged smoke |
| Status | **Open** — release blocker for public Electron; WP6 Todo (no dep changes in WP1) |

---

### Medium

#### M1 — Progress sync full-snapshot LWW (WAL-251)

| Field | Detail |
|-------|--------|
| Severity | **Medium** (claims: High) |
| Component | `backend/src/services/progress.js`; `src/auth.js`; migration `004` `updated_at` unused for CAS |
| Evidence | `PUT /me/progress` replaces entire document; no If-Match / revision |
| Impact | Concurrent web+Electron edits can silently clobber |
| Remediation | Optimistic concurrency — [WAL-251](https://linear.app/waley-nagdi/issue/WAL-251/add-optimistic-concurrency-protection-to-cross-device-progress) (WP4; **not** WP1) |
| Verification | Concurrent two-client conflict tests; 409 refetch path |
| Status | **Claims-blocked** — Todo; leave open; sequential sync accepted |

#### M2 — Stale docs claimed OAuth / deploy not implemented

| Field | Detail |
|-------|--------|
| Severity | **Medium** (honesty / audit) |
| Component | `docs/SECURITY.md`, `ARCHITECTURE.md`, `THREAT_MODEL.md`, `README.md`, `RAILWAY.md`, `VERCEL.md`, `backend/README.md` |
| Evidence | Docs contradicted Phase 8 ops + code (OAuth live; Vercel/Railway deployed) |
| Impact | False security/product claims for auditors and clients |
| Remediation | WP1 documentation truth pass (this work) |
| Verification | Doc review against code + Phase 8 checklist |
| Status | **Documented** — corrected in WP1; residual acceptance [WAL-253](https://linear.app/waley-nagdi/issue/WAL-253/wp1b-accept-phase-9-residual-risk-register) |

#### M3 — In-process auth rate limits only

| Field | Detail |
|-------|--------|
| Severity | **Medium** |
| Component | `backend/src/middleware/rateLimit.js`; config defaults ~20/15m; logout not limited |
| Evidence | In-memory counters; not distributed across instances |
| Impact | Weak multi-instance / sustained abuse protection |
| Remediation | Document residual; optional logout limit + edge WAF later (WP5 / Cloudflare planned) |
| Verification | Multi-instance abuse test only after distributed controls |
| Status | **Accepted residual** (current scale) — polish in [WAL-256](https://linear.app/waley-nagdi/issue/WAL-256/wp5-vercel-csp-header-and-api-hardening-polish) |

#### M4 — Google ID token decoded without JWKS verify

| Field | Detail |
|-------|--------|
| Severity | **Medium** |
| Component | `googleOAuth.js` `decodeIdTokenPayload` / `assertGoogleIdentity` |
| Evidence | Payload decoded after token endpoint exchange with `client_secret`; no JWKS signature check |
| Impact | Weaker defense-in-depth if token endpoint trust assumptions change |
| Remediation | JWKS verify — [WAL-255](https://linear.app/waley-nagdi/issue/WAL-255/wp3-oauth-jwks-verify-and-exchange-delivery-m4m5) |
| Verification | Unit tests with signed/invalid tokens |
| Status | **Deferred (WP3)** |

#### M5 — OAuth exchange code in redirect query string

| Field | Detail |
|-------|--------|
| Severity | **Medium** |
| Component | Google OAuth complete redirect (`google_exchange`); hashed store, ~120s TTL, one-time |
| Evidence | Query parameter visible in history/referrer/logs |
| Impact | Short-lived code leakage risk |
| Remediation | Fragment/POST delivery where feasible — WAL-255 |
| Verification | Client callback tests; no long-lived codes |
| Status | **Deferred (WP3)** |

#### M6 — Web CSP meta-only (no Vercel CSP header)

| Field | Detail |
|-------|--------|
| Severity | **Medium** |
| Component | `scripts/build-web.mjs` meta CSP; `vercel.json` lacks CSP header |
| Evidence | Electron injects CSP via `webRequest`; web relies on meta |
| Impact | Meta CSP weaker / easier to bypass than response headers in some cases |
| Remediation | CSP header in `vercel.json` — WAL-256 |
| Verification | Response header inspection on production web |
| Status | **Deferred (WP5)** |

#### M7 — Client-trusted progress integrity (XP/solved)

| Field | Detail |
|-------|--------|
| Severity | **Medium** (accepted for learning app) |
| Component | `progressValidation.js`; server stores client JSON within bounds |
| Evidence | No server-side mission correctness proof |
| Impact | Users can inflate own XP/solved on their account |
| Remediation | Keep as accepted residual unless product requires server grading |
| Verification | Threat-model honesty in docs |
| Status | **Accepted residual** |

#### M8 — Soft unlock when progress sync fails

| Field | Detail |
|-------|--------|
| Severity | **Medium** |
| Component | `src/auth.js` soft-unlock path |
| Evidence | Auth can unlock with local progress if `/me/progress` fails |
| Impact | Local/server divergence until next successful sync |
| Remediation | Document; harden UX later if needed |
| Verification | Offline / API-down manual check |
| Status | **Accepted residual** (documented) |

#### M9 — Password reset stub visible

| Field | Detail |
|-------|--------|
| Severity | **Medium** (product honesty) |
| Component | Auth UI “Forgot password?” |
| Evidence | Phase 8: temporarily unavailable stub |
| Impact | Marketing/feature expectation mismatch — not an auth bypass |
| Remediation | Keep honesty; implement later or hide CTA |
| Verification | Manual UI check |
| Status | **Accepted residual** (honesty) |

#### M10 — DB integration / refresh concurrency tests skipped without DATABASE_URL

| Field | Detail |
|-------|--------|
| Severity | **Medium** (CI coverage) |
| Component | Backend test suite |
| Evidence | 3 skips when `DATABASE_URL` unset |
| Impact | Live Postgres concurrency not proven in default CI |
| Remediation | Optional CI Postgres job |
| Verification | Run suite with `DATABASE_URL` |
| Status | **Accepted residual** (document) |

---

### Low

| ID | Finding | Component | Evidence | Impact | Remediation | Verification | Status |
|----|---------|-----------|----------|--------|-------------|--------------|--------|
| **L1** | CSP `'unsafe-inline'` | Electron + web build | Monolithic `index.html` | XSS impact window larger | Reduce when UI modularized | CSP audit | Accepted residual |
| **L2** | Lint scope Electron-only | `package.json` scripts | eslint electron | Client/backend lint gaps | Expand lint later | CI lint paths | Accepted residual |
| **L3** | `oauth_exchanges` no TTL cleanup job | migration `006` | Schema only | Stale hashed rows accumulate | Periodic cleanup job | DB hygiene | Deferred |
| **L4** | Browser sessions memory-only | web client | Phase 7 design | Tab close ends session | Planned stronger web session | Manual | Accepted by design |
| **L5** | Unit tests ≠ OS Keychain proof | Electron tests | Mocked `safeStorage` | Overclaim risk | Keep SECURITY honesty | Doc review | Accepted residual |
| **L6** | No Cloudflare / WAF | hosting | Docs PLANNED | Edge abuse protection absent | Phase later | Ops | Accepted residual |
| **L7** | Health payload `phase: 4` | `routes/index.js` | Cosmetic | Confusing ops signal | Bump string | `/health` | Deferred polish |
| **L8** | Outdated packages (Electron far behind latest) | root deps | Audit + versions | Maintenance / CVE surface | WP6 + Phase 10 | Audit after upgrade | Deferred (WP6) |

---

### Informational

- Single-user ownership model (not multi-tenant) — consistent across docs/code.
- Email vs Google identities remain separate unless linked — Phase 8 operator note.
- Packaged Electron default API → Railway HTTPS — VERIFIED `electron/main.cjs`.
- CORS allowlist (no `*`) — VERIFIED code; Phase 8 A3 PASS (ASSUMED live).
- Refresh family rotation + reuse revoke — VERIFIED services + tests.
- Parameterized SQL + error redaction — VERIFIED.
- Production TLS defaults + Railway private-mesh exception — VERIFIED `db/index.js`.
- Web build secret/localhost scanners — VERIFIED `build-web.mjs` + tests.
- WAL-202 Done; notes persistence production PASS (ASSUMED ops, Phase 8).

---

## Work packages (Phase 9)

| WP | Linear | Focus | Status |
|----|--------|-------|--------|
| WP1 | [WAL-252](https://linear.app/waley-nagdi/issue/WAL-252/wp1-docs-truth-and-residual-risk-register) | Docs truth + this register | **In Progress** |
| WP1b | [WAL-253](https://linear.app/waley-nagdi/issue/WAL-253/wp1b-accept-phase-9-residual-risk-register) | Operator acceptance of residuals | Todo |
| WP2 | [WAL-254](https://linear.app/waley-nagdi/issue/WAL-254/wp2-harden-google-email-auto-link-h1) | H1 Google link hardening | Todo — **do not start** |
| WP3 | [WAL-255](https://linear.app/waley-nagdi/issue/WAL-255/wp3-oauth-jwks-verify-and-exchange-delivery-m4m5) | M4/M5 OAuth defense-in-depth | Todo |
| WP4 | [WAL-251](https://linear.app/waley-nagdi/issue/WAL-251/add-optimistic-concurrency-protection-to-cross-device-progress) | Optimistic concurrency | Todo (claims blocker) |
| WP5 | [WAL-256](https://linear.app/waley-nagdi/issue/WAL-256/wp5-vercel-csp-header-and-api-hardening-polish) | Web CSP header + API polish | Todo |
| WP6 | [WAL-257](https://linear.app/waley-nagdi/issue/WAL-257/wp6-electron-dependency-cve-triage-h3) | Electron CVE triage | Todo |
| — | [WAL-249](https://linear.app/waley-nagdi/issue/WAL-249/engineering-framework-planned-why-follow-up) | Engineering framework child | Todo (framework) |

---

## Documentation corrections (WP1)

Stale “not deployed / OAuth not implemented / OAuth IPC rejects” claims corrected in:

- `docs/SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/THREAT_MODEL.md`
- `docs/ROADMAP.md`
- `docs/RAILWAY.md`
- `docs/VERCEL.md`
- `README.md`
- `backend/README.md`

Residual risks (H1–H3, M1–M10, L1–L8) remain **honestly listed** — correcting deploy/OAuth status does **not** clear release blockers.

---

## Phase 9 status

| Item | State |
|------|-------|
| Pre-implementation audit | Complete (read-only) |
| WP1 documentation truth | In Progress (this commit when approved) |
| WP2+ implementation | **Not started** |
| Phase 9 / WAL-186 | **In Progress** — not Done |
| WAL-251 | **Todo** — claims blocker only |
