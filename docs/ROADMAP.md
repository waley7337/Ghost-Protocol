# Ghost Protocol — Development Roadmap

**Document status:** Reconstructed from repository evidence (git history, docs, code, tests) plus a **user-provided production checkpoint** (2026-08-13).  
**Honesty labels used throughout:** `IMPLEMENTED` (code exists) · `CODE-ONLY` (implemented but not product-verified here) · `VERIFIED` (confirmed by tests or user/ops evidence) · `PLANNED` · `Reconstructed` (phase naming inferred when docs were silent).

Do **not** treat `IMPLEMENTED` as production-verified. Do **not** invent historical phase names beyond what commits/docs support.

---

## 1. Current architecture

```
┌────────────────────────────┐     ┌────────────────────────────┐
│ Electron desktop           │     │ Web static SPA (Vercel)    │
│ Renderer → preload → main  │     │ Memory-only access+refresh │
│ Refresh: safeStorage       │     │                            │
└─────────────┬──────────────┘     └─────────────┬──────────────┘
              │ HTTPS JSON                       │ HTTPS JSON
              └────────────────┬─────────────────┘
                               ▼
                    Ghost Protocol API (Railway)
                    /auth/*  /me/profile  /me/progress
                    /health   /health/db
                               │
                               ▼
                    Railway PostgreSQL
```

| Layer | Role | Evidence |
|-------|------|----------|
| Electron | Desktop app; CSP; IPC; OAuth deep-link; packaged API default → Railway | `electron/*`, `package.json` build, commit `4360440` |
| Web | Static SPA via `npm run build:web` → `dist/web`; `vercel.json` | `scripts/build-web.mjs`, `docs/VERCEL.md` |
| API | Node HTTP; Argon2id; JWT access; hashed refresh; Google OAuth; CORS | `backend/src/**`, migrations `001`–`006` |
| DB | `users`, `sessions`, `profiles`, `user_progress` (+ Google columns) | `backend/migrations/*` |
| Learning UI | Shared `index.html` missions (labs), XP, ranks, notes, glossary | Monolithic renderer; not redesigned in later phases |

**Explicit non-architecture (current):** No Redis. No Supabase at runtime (`supabase/` is LEGACY/HISTORICAL only). No Cloudflare edge in front (still PLANNED in older docs).

**Documentation truth (Phase 9 WP1):** `README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/RAILWAY.md`, `docs/VERCEL.md`, `docs/THREAT_MODEL.md`, and `backend/README.md` are aligned with deployed Vercel/Railway + live Google OAuth. Residual risks and release blockers are recorded in `docs/PHASE-9-AUDIT.md` — correcting deploy/OAuth status does **not** clear H1–H3 or WAL-251 claims limits.

---

## 2. Completed milestones (repository evidence)

| Milestone (repo-named where possible) | Evidence | Status |
|---------------------------------------|----------|--------|
| Repository baseline | `3d9b693` | IMPLEMENTED |
| Secure application scaffold | `32244d5` | IMPLEMENTED |
| PostgreSQL data foundation | `a33bd06`, migrations `001`–`004` | IMPLEMENTED |
| Railway runtime readiness (code) | `ece206a`, `docs/RAILWAY.md` | IMPLEMENTED (deploy later) |
| Auth + session foundation | `639f1e7`, refresh family `88e4543` / `005` | IMPLEMENTED + unit tests |
| Profile + progress API + ownership | `804006c` | IMPLEMENTED + ownership tests |
| Client migration off Supabase | `6f80ea3`, `16b0cea` | IMPLEMENTED |
| Electron credential hardening (Phase 6) | `b4008fd`, `docs/SECURITY.md` | IMPLEMENTED + electron tests |
| Browser/web + CORS (Phase 7) | `fc51cec`, `df86298`, `c631f0a` | IMPLEMENTED + web tests |
| Google OAuth (production-oriented) | `2826049`, migration `006`, `googleOAuth.js` | IMPLEMENTED (**CODE**); user reports production VERIFIED |
| Production DB TLS / redacted errors | `26ead56` | IMPLEMENTED |
| Vercel rebuild trigger | `222e1cc` | Ops evidence in git only |
| Packaged Electron → Railway API | `4360440` | IMPLEMENTED; user: macOS ARM64 email + Google VERIFIED |

**Reconstructed earlier product baseline (pre-phase numbering):** Interactive HTTP request-smuggling learning UI (22 labs), XP/ranks, notes, localStorage cache — present in `index.html` from baseline era.

---

## 3. Current production checkpoint

### User-provided VERIFIED facts (treat as ops truth; not re-proven by this document alone)

| Fact | Value |
|------|--------|
| Frontend | Vercel `https://ghost-protocol-pi.vercel.app` |
| Backend | Railway `https://ghost-protocol-production-f7ef.up.railway.app` |
| Database | Railway PostgreSQL |
| Supabase | Removed from current runtime architecture |
| Email registration/login | Works in production |
| Google OAuth | Works in production |
| Migrations | `001`–`006` applied; zero pending |
| Health | `GET /health` 200; `GET /health/db` 200 |
| Vercel → API | Production config points to Railway API |
| Packaged Electron (macOS ARM64) | Uses Railway; email/password + Google manually verified |
| Latest `main` | `4360440` |
| Prior local suites (user) | electron `21/21`; complete suite `48/48` |

### Repository CODE-ONLY corroboration

- Packaged Electron default API base hardcodes the Railway HTTPS origin (`electron/main.cjs`).
- Google OAuth routes and services exist under `backend/src/routes` + `services/googleOAuth.js`.
- Client Google exchange + Electron `beginOAuth` / deep-link callback are wired in `src/auth.js` / `electron/main.cjs`.

---

## 4. Phase 8 — Full product functionality verification

**Goal:** Prove (or honestly map gaps in) end-to-end product behavior across auth, learning loop, progress sync, and web/Electron parity — without redesign or deploy changes.

**Activities**

1. Feature inventory + verification matrix → `docs/PHASE-8-VERIFICATION.md`
2. Run all non-destructive automated suites (root + backend)
3. Production manual QA checklist → `docs/PRODUCTION-QA-CHECKLIST.md`
4. Separate CODE-ONLY vs VERIFIED vs PLACEHOLDER features (e.g. password reset, quizScores UI)

**Definition of done (Phase 8)**

- [x] `docs/ROADMAP.md` exists with reconstructed remaining phases
- [x] `docs/PHASE-8-VERIFICATION.md` inventory matrix complete
- [x] Automated suites executed; pass/fail/skip totals recorded
- [x] `docs/PRODUCTION-QA-CHECKLIST.md` published for web + Electron + sync
- [x] Production manual checklist executed by operator (2026-08-14) — see checklist + verification docs
- [x] No open **Confirmed defects** that block core learning loop — **E4 / WAL-202** production retest **PASS** 14 August 2026

**Phase 8 status (14 August 2026):** **Done.** Manual production QA passed across Vercel, Railway, and packaged Electron. **WAL-202** production retest PASS (notes leave/reopen, web+Electron logout/login, web↔Electron sync; solved/XP/rank intact). Remaining limitations (password reset stub, unfinished UI shells, etc.) and Phase 9 tech debt (**WAL-251** concurrency) remain open — not claimed as done.

---

## 5. Phase 9 — Security and production-readiness audit

**Linear:** [WAL-186](https://linear.app/waley-nagdi/issue/WAL-186/09-security-audit-and-release-hardening) **In Progress** (started 14 August 2026). Register: `docs/PHASE-9-AUDIT.md`.

**Goal:** Threat-informed review of auth, session storage, CORS, CSP, OAuth, ownership isolation, secret handling, and residual production risks — without claiming OS Keychain proof from unit tests.

**Approved release position**

- **Conditional GO:** private testing, portfolio screenshots, controlled demos
- **NO-GO:** public Electron distribution (unsigned / not notarized — **H2**; Electron audit High — **H3**)
- **NO-GO:** claims of conflict-safe concurrent multi-device synchronization (**WAL-251**)

**Work packages**

| WP | Focus | Linear | Status |
|----|-------|--------|--------|
| WP1 | Docs truth + residual-risk register | WAL-252 | **In Progress** |
| WP1b | Accept residual-risk register | WAL-253 | Todo |
| WP2 | Harden Google email auto-link (**H1**) | WAL-254 | Todo — do not start in WP1 |
| WP3 | OAuth JWKS + exchange delivery | WAL-255 | Todo |
| WP4 | Optimistic concurrency | WAL-251 | Todo (claims blocker) |
| WP5 | Vercel CSP header + API polish | WAL-256 | Todo |
| WP6 | Electron CVE triage (**H3**) | WAL-257 | Todo |

**Definition of done**

- [x] Pre-implementation read-only audit (H1–H3, M1–M10, L1–L8)
- [x] Walk `docs/SECURITY.md` + `docs/THREAT_MODEL.md` against current code (WP1)
- [x] Correct stale OAuth/deploy claims in README / ARCHITECTURE / RAILWAY / VERCEL / backend README (WP1)
- [x] Document residual risks + explicit release blockers in `docs/PHASE-9-AUDIT.md`
- [ ] Operator acceptance of residual register (WAL-253)
- [ ] WP2+ code remediations as sequenced (not WP1)
- [ ] Optional: live cross-user isolation against Railway only if approved
- [ ] **WAL-251:** optimistic concurrency — leave Todo; blocks concurrent-sync *claims* only until implemented

**Phase 9 status:** **In Progress (WP1 only).** Do not mark Done after documentation alone.

---

## 6. Phase 10 — Desktop and cross-platform release verification

**Reconstructed.**

**Goal:** Release-quality Electron artifacts beyond macOS ARM64 smoke.

**Definition of done**

- [ ] macOS ARM64 packaged build re-verified against Railway (auth + deep-link)
- [ ] Windows NSIS and/or Linux AppImage/deb built and smoke-tested where hardware allows
- [ ] Signing / notarization plan documented (credentials not in-repo)
- [ ] Protocol handler (`ghost-protocol://`) verified cold-start + warm callback
- [ ] Release notes / version alignment with `package.json` `1.0.0`

---

## 7. Phase 11 — Portfolio / case-study creation

**Reconstructed.** Stop here until Phases 8–10 evidence exists.

**Definition of done**

- [ ] Case study draft: problem, architecture, security decisions, before/after (Supabase → first-party)
- [ ] Screenshots/GIFs from production QA (web + Electron)
- [ ] Honest scope: what is PLANNED (password reset, Cloudflare, browser persistent session)

---

## 8. Phase 12 — Fiverr launch

**Reconstructed.** Do not start until portfolio evidence is ready.

**Definition of done**

- [ ] Gig positioning + deliverables list
- [ ] Demo account / sandbox policy (no production data abuse)
- [ ] Support/security boundaries published (what clients get vs host secrets)

---

## 9. Known risks and blockers

| Risk / blocker | Severity | Notes |
|----------------|----------|-------|
| **H1 Google email auto-link pre-hijack** | **High** | Release blocker for broad Google acquisition — WAL-254 WP2 |
| **H2 Unsigned / not-notarized Electron** | **High** | **NO-GO** public Electron distribution |
| **H3 Electron npm audit High CVEs** | **High** | **NO-GO** wide public desktop until WP6 triage |
| **WAL-251 progress LWW concurrency** | Medium (claims: High) | **NO-GO** for conflict-safe concurrent sync *claims*; sequential OK; leave Todo |
| Password reset UI stub | Medium | Visible “Forgot password?” → “temporarily unavailable” |
| Quizzes / achievements / settings fields | Medium | Present in progress schema; **no product UI writers** found in `index.html` |
| Browser session ends on tab close | Medium by design | Memory-only refresh (Phase 7); Electron persists via safeStorage |
| Sync failure soft-unlock | Low–Medium | Auth can unlock with local progress if `/me/progress` fails |
| In-process rate limiting | Medium | Not distributed abuse protection |
| Cloudflare / WAF | Low–Medium | Still PLANNED |
| Unit tests ≠ Keychain proof | Low | Documented in SECURITY.md |
| Legacy `supabase/` tree | Low | Historical only; keep out of runtime |
| Product E2E for missions | Medium | No automated UI tests for labs/XP; relies on manual QA |
| **E4 / WAL-202 mission notes sync** | **Resolved** | Production PASS 14 August 2026. WAL-202 Done. |
| Docs truth vs production | **Addressed WP1** | See `docs/PHASE-9-AUDIT.md`; residuals remain |

---

## 10. Definition of done — remaining phases (summary)

| Phase | Done when |
|-------|-----------|
| **8** | **Complete 14 August 2026** — inventory + automated totals + production checklist; operator acceptance PASS (incl. WAL-202 notes); limitations + Phase 9 debt documented honestly |
| **9** | Residual register accepted (WAL-253); H1–H3 sequenced; WAL-251 claims honesty maintained; **not** Done after WP1 docs alone |
| **10** | Cross-platform package smoke + deep-link + signing plan |
| **11** | Portfolio case study with real production evidence |
| **12** | Fiverr gig ready with clear security/support boundaries |

**Stop rule:** Phase 8 manual QA is complete (14 August 2026). Do not begin Phase 11/12 until Phases 9–10 evidence exists. Do not claim password reset, unfinished UI shells, signing/notarization, Windows/Linux builds, or concurrency protection as done.
