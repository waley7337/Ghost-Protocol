# Production Manual QA Checklist

**Purpose:** Operator-executed, non-destructive checks against live Vercel + Railway + packaged Electron.  
**Do not** change Railway/Vercel/Google/GitHub settings or production data beyond normal user flows (register/login, progress for **disposable test accounts**).  
**Evidence for Fiverr/case study:** capture screenshots/short clips as noted; never capture secrets, tokens, or `.env` values.

| Environment | URL / artifact |
|-------------|----------------|
| Web | `https://ghost-protocol-pi.vercel.app` |
| API | `https://ghost-protocol-production-f7ef.up.railway.app` |
| Electron | Packaged macOS ARM64 build from `release/` (Railway API) |

**Operator run:** 2026-08-14 — results recorded below.  
Mark each row: ☐ Pass · ☐ Fail · ☐ Blocked · ☐ N/A · ☑ as executed.

**Account clarification (operator):** Email and Google are intentionally separate identities with separate progress — **NOT** a sync bug.

---

## A. Railway API & database connectivity

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| A1 | `curl` `/health` | `200`; JSON `status: ok`, `authConfigured: true` | ☑ **PASS** | health 200 |
| A2 | Same for `/health/db` | `200`; `status: ok` | ☑ **PASS** | health/db 200 |
| A3 | `OPTIONS` preflight `/auth/login` from Vercel origin | CORS allows Vercel origin; no `*` with credentials | ☑ **PASS** | OPTIONS 204; `allow-origin` = Vercel; no wildcard |

---

## B. Vercel web — email registration / login

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| B1 | Open web app; wait for auth gate | Auth UI: Google, email, password, Create account | ☑ **PASS** | — |
| B2 | Create account with **new disposable** email + strong password | Account created; gate dismisses; app/splash proceeds | ☑ **PASS** | — |
| B3 | Note profile email/name | Matches account | ☑ **PASS** | — |
| B4 | Log out | Auth gate returns | ☑ **PASS** | — |
| B5 | Log in with same credentials | Session restores; progress hydrate | ☑ **PASS** | — |

---

## C. Vercel web — Google OAuth

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| C1 | Click Continue with Google | Redirect to Google → API callback → back to Vercel with session | ☑ **PASS** | — |
| C2 | Confirm profile email is Google account | Profile panel correct | ☑ **PASS** | — |
| C3 | Log out; Google sign-in again | Returns to existing account (no conflict error) | ☑ **PASS** | — |

---

## D. Profile persistence

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| D1 | While signed in, note displayed name/rank/XP | Values visible | ☑ **PASS** | — |
| D2 | If name can be changed via UI/API in future — skip if read-only | N/A if no edit UI | ☑ **N/A** | no profile-edit UI |
| D3 | Sign out and back in (same method) | Same identity and prior XP/solved state | ☑ **PASS** | — |

---

## E. Mission / quiz progress, XP, ranks, achievements

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| E1 | Open OPS CENTER; pick an unsolved practitioner lab | ACTIVE MISSION loads with editor | ☑ **PASS** | — |
| E2 | Send an **incorrect** payload | Non-win response / toast; XP unchanged; not marked solved | ☑ **PASS** | — |
| E3 | Send a **correct** payload (use solution if needed for QA) | Win; XP increases; solved badge; optional rank-up popup | ☑ **PASS** | LAB-01; 150 XP; Recruit |
| E4 | Add mission notes; leave lab; return; logout/login | Notes persisted through local nav **and** server hydrate | ☑ **PASS** | Operator retest 14 Aug 2026: notes survived leave/reopen, web logout/login, Electron logout/login; same notes web↔Electron; solved/XP/rank intact. WAL-202 Done. |
| E5 | Open RANKS | Current rank highlighted consistent with XP | ☑ **PASS** | — |
| E6 | Achievements / Quizzes / Settings | **Honest check:** no achievements/quiz/settings product UI — confirm absence | ☑ **PASS WITH DOCUMENTED LIMITATION** | quizzes/achievements/settings are progress schema shells only; no product UI |
| E7 | Wait ~2s after solve (debounce sync) | No sync error toast | ☑ **PASS** | — |

---

## F. Cross-device web ↔ Electron synchronization

Use **one** disposable account.

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| F1 | On web: complete E1–E3; note XP + solved lab id | Baseline | ☑ **PASS** | — |
| F2 | On Electron: sign in same account (email or Google) | Progress matches web (solved + XP + notes) | ☑ **PASS** | web↔Electron notes sync PASS |
| F3 | On Electron: solve a **different** lab | XP updates locally | ☑ **PASS** | — |
| F4 | On web: log out/in or restore session (see web limits) | Electron changes appear after successful hydrate | ☑ **PASS** | — |
| F5 | Document web session limitation | Full browser tab close / hard refresh ends web session (memory-only) — must re-login | ☑ **PASS** | browser memory-only on hard refresh |

---

## G. Logout / login restoration

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| G1 | Electron: logout → login | Progress intact from server | ☑ **PASS** | — |
| G2 | Web: logout → login | Progress intact from server (solved/XP/notes) | ☑ **PASS** | notes + solved/XP after web logout/login |
| G3 | Electron: quit app fully → relaunch | Session restores without password if safeStorage available | ☑ **PASS** | Electron safeStorage |
| G4 | Web: hard refresh (F5) while signed in | **Expect re-login** (memory tokens cleared) | ☑ **PASS** | web hard refresh → auth gate |

---

## H. Electron deep-link Google callback

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| H1 | Electron logged out → Continue with Google | System browser opens API Google start URL | ☑ **PASS** | — |
| H2 | Complete Google consent | App receives `ghost-protocol://auth/callback?...` and signs in | ☑ **PASS** | — |
| H3 | Reject/cancel Google once | Friendly error; remains on auth gate | ☑ **PASS WITH UX LIMITATION** | no cancel message; external browser tab may remain open after Electron auth |

---

## I. Error and offline behavior

| # | Steps | Expected | Result | Evidence |
|---|-------|----------|--------|----------|
| I1 | Wrong password on login | Friendly “Incorrect email or password” (no stack/secrets) | ☑ **PASS** | — |
| I2 | Forgot password click | “Password reset is temporarily unavailable.” | ☑ **PASS** | — |
| I3 | Disable network; attempt login or progress action | Clear failure; no crash; no secret leakage | ☑ **PASS** | UX notes for offline |
| I4 | Re-enable network; login | Recovers | ☑ **PASS** | — |

---

## J. Case-study evidence pack (Fiverr / portfolio)

Collect into a private folder (do not commit secrets):

1. Architecture diagram (from `docs/ARCHITECTURE.md` / ROADMAP)  
2. Auth gate (web + Electron)  
3. Google OAuth success (web + Electron deep-link)  
4. Mission solve + XP/rank  
5. Cross-device sync proof (two screenshots, same account)  
6. Health endpoints 200  
7. Honest “not included” slide: password reset, quizzes/achievements/settings UI, Cloudflare  

---

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Operator | Production acceptance | 2026-08-14 | ☑ **PASS** — Phase 8 complete (E4 / WAL-202 retest PASS) |
| Engineering | Docs close-out | 2026-08-14 | Automated suites green (69/69 + backend 57/3 skip); WAL-202 Done; Phase 8 Done |

**Blocked items:** None for Phase 8. E4 / **WAL-202** production retest **PASS** 14 August 2026.

**Waivers / documented limitations:** E6 (quizzes/achievements/settings schema shells only — no product UI); H3 UX limitation (cancel messaging / leftover browser tab); password reset stub; email vs Google = separate identities (not a sync bug). Do **not** claim signing/notarization, Windows/Linux builds, or concurrency protection.

**Phase 9 debt (open):** **WAL-251** — optimistic concurrency for concurrent multi-client progress edits (current model remains full-snapshot LWW); Phase 9 parent **WAL-186**
