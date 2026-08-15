# Ghost Protocol — Desktop Release (Phase 10)

**Status:** macOS ARM64 demonstrable package for portfolio / Fiverr / controlled demos.
**Not for:** public unsigned distribution (H2), wide desktop claims until WP6/CVE triage (WAL-257).

| Field | Value |
|-------|--------|
| Version | `1.0.0` (`package.json`) |
| Product | Ghost Protocol (`com.waleyelnagdi.ghostprotocol`) |
| Platform | macOS ARM64 |
| Source commit | `59cd8b7` (`fix(auth): prevent OAuth initialization readiness hang`) |
| Linear | [WAL-183](https://linear.app/waley-nagdi/issue/WAL-183/10-desktop-release) |
| Build time (this package) | 2026-08-15 ~11:41–11:42 CEST |

## Artifacts (gitignored `release/`)

- **Canonical demo artifact:** `release/mac-arm64/Ghost Protocol FINAL.app`
- `release/mac-arm64/Ghost Protocol.app` (builder output; prefer FINAL for demos)
- `release/Ghost Protocol-1.0.0-arm64.dmg`
- `release/Ghost Protocol-1.0.0-arm64-mac.zip`

## Build procedure

```bash
git checkout main && git pull
npm run build:mac   # auth:bundle + electron-builder --mac (dmg + zip)
# Optional local launch (ad-hoc):
codesign --force --deep --sign - "release/mac-arm64/Ghost Protocol.app"
open "release/mac-arm64/Ghost Protocol.app"
```

No Developer ID / notarization in this pass (expected). Gatekeeper will warn; ad-hoc resign is for local demo launch only.

## API target (packaged)

Packaged builds default to Railway production HTTPS:

`https://ghost-protocol-production-f7ef.up.railway.app`

(`electron/main.cjs` packaged fallback; fail-closed — no localhost invent in packaged preload). Dev/unpackaged still uses `http://127.0.0.1:3000`.

## Capabilities (this package)

- Auth gate: Google + email/password UI
- Electron `safeStorage` session path (Keychain prompt on first access)
- OAuth deep-link scheme `ghost-protocol://`
- Progress/profile sync against Railway when signed in
- Auth readiness / boot hang fix from `59cd8b7` (`ghostAuthReady` / `ghostResolveAuthForBoot`)
- Branding: product name, icon.icns, Ghost Protocol chrome

## Limitations (honest)

| Item | Notes |
|------|--------|
| **H2 unsigned / not notarized** | NO-GO public Electron distribution; ad-hoc only for controlled demos |
| **WAL-257 / H3** | Electron dependency CVE triage deferred — do not claim wide public desktop readiness |
| **WAL-251** | No optimistic concurrency — do not claim conflict-safe multi-device sync |
| **WAL-256** | Vercel CSP polish deferred (web; not this desktop package) |
| Windows / Linux packages | Not verified in this Phase 10 demo pass ([WAL-211](https://linear.app/waley-nagdi/issue/WAL-211/limitation-windowslinux-packaged-release-not-yet-verified)) |
| Password reset | Stub (“temporarily unavailable”) |
| Stale `/Applications` install | Do **not** QA against `/Applications/Ghost Protocol.app` (older); use fresh `release/mac-arm64/` |

## Install / demo notes

1. Prefer the fresh `.app` or `.dmg` from `release/` built at the timestamp above.
2. On first launch, macOS may prompt for Keychain access to `ghost-protocol Safe Storage` — Allow for session persistence demos.
3. Google OAuth: click **CONTINUE WITH GOOGLE** in the **fresh** app; complete consent in the browser; expect `ghost-protocol://` callback.
4. Email/password: use a disposable account only; no demo credentials are stored in-repo.

## QA status (2026-08-15 Phase 10)

| Check | Result |
|-------|--------|
| Fresh `npm run build:mac` | PASS (dmg + zip + app) |
| asar: `electron/security.cjs`, Railway API, readiness markers, icons | PASS |
| Canonical `Ghost Protocol FINAL.app` launch | **PASS** (manual) |
| Keychain / safeStorage — Always Allow | **PASS** (manual) |
| Google OAuth end-to-end | **PASS** (manual) |
| Email/password login | **SKIPPED** — no safe demo credentials in docs/env |
| Automated suites (lint / client / electron / web / backend / build:web) | See Phase 10 pre-commit report |

**Verdict:** Manual QA PASS on canonical FINAL.app (launch, Google OAuth, Keychain Always Allow). Unsigned/ad-hoc only (H2 deferred). Phase 10 closable.
