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

**Stale docs note:** `README.md`, `docs/ARCHITECTURE.md`, `docs/RAILWAY.md`, `docs/VERCEL.md`, and `backend/README.md` still describe Phase 7 as “not deployed” and Google OAuth as unimplemented. **Repository commits after Phase 7 docs** (`2826049`, `26ead56`, `222e1cc`, `4360440`) and the user production checkpoint supersede those statements for deploy/OAuth status.

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
- [ ] No open **Confirmed defects** that block core learning loop — **E4 mission-notes persistence** fixed in code; **pending operator production retest** (not PASS yet)

**Phase 8 status (2026-08-14):** **In Progress.** Manual QA complete for A–I except **E4**. **WAL-202** (mission notes persistence) remains **In Progress** — code fix landed; **production retest pending** (do not mark E4 PASS / Phase 8 Done until operator QA). Email vs Google = separate identities (not a sync bug).

---

## 5. Phase 9 — Security and production-readiness audit

**Reconstructed** name (aligned with user request; prior chat deleted).

**Goal:** Threat-informed review of auth, session storage, CORS, CSP, OAuth, ownership isolation, secret handling, and residual production risks — without claiming OS Keychain proof from unit tests.

**Do not start Phase 9 implementation until Phase 8 / WAL-202 production retest passes.**

**Definition of done**

- [ ] Walk `docs/SECURITY.md` + `docs/THREAT_MODEL.md` against current code (OAuth now live — update stale “NOT IMPLEMENTED” claims)
- [ ] Confirm no server secrets in Vercel/Electron/public bundles
- [ ] Review refresh rotation / reuse, rate limits, CORS allowlist, deep-link validation
- [ ] Document residual risks (browser memory-only sessions, password reset absent, in-process rate limits, signing/notarization)
- [ ] Optional: live cross-user isolation against Railway only if approved (read-only or disposable accounts; no destructive DB ops)
- [ ] **WAL-251 (technical debt):** optimistic concurrency for cross-device progress sync — today is full-snapshot LWW; WAL-202 unload/hydrate safety does not solve concurrent multi-client edits

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
| Docs stale vs production | Medium | README/ARCHITECTURE still say undeployed / OAuth unimplemented |
| Password reset UI stub | Medium | Visible “Forgot password?” → “temporarily unavailable” |
| Quizzes / achievements / settings fields | Medium | Present in progress schema; **no product UI writers** found in `index.html` |
| Browser session ends on tab close | Medium by design | Memory-only refresh (Phase 7); Electron persists via safeStorage |
| Sync failure soft-unlock | Low–Medium | Auth can unlock with local progress if `/me/progress` fails |
| In-process rate limiting | Medium | Not distributed abuse protection |
| Cloudflare / WAF | Low–Medium | Still PLANNED |
| Desktop signing/notarization | High for public distro | Not configured in-repo |
| Unit tests ≠ Keychain proof | Low | Documented in SECURITY.md |
| Legacy `supabase/` tree | Low | Historical only; keep out of runtime |
| Product E2E for missions | Medium | No automated UI tests for labs/XP; relies on manual QA |
| **E4 / WAL-202 mission notes sync** | **High until retest** | Production FAIL 2026-08-14: notes lost after logout/login. Code fix (flush on logout + input capture); **WAL-202 In Progress — blocked on production retest** |
| **WAL-251 progress LWW concurrency** | Medium (Phase 9 debt) | Concurrent active clients can still clobber each other (full-snapshot LWW). Tracked for Phase 9; out of scope for WAL-202 |

---

## 10. Definition of done — remaining phases (summary)

| Phase | Done when |
|-------|-----------|
| **8** | Inventory + automated totals + production checklist artifact; operator completes checklist or documents waivers; core loop defect-free or severity-tracked |
| **9** | Security audit write-up; stale OAuth/deploy claims corrected; residual risks listed with severity |
| **10** | Cross-platform package smoke + deep-link + signing plan |
| **11** | Portfolio case study with real production evidence |
| **12** | Fiverr gig ready with clear security/support boundaries |

**Stop rule:** Do not begin Phase 11/12 work until Phase 8 manual QA is complete (or explicitly deferred with documented risk).
