# M8 results — Settings, privacy and release polish

Branch `claude/m8-settings-release-polish` (from `claude/m7-overlay-integration`). Verified locally: Chromium 141 (full e2e, 29 tests) and Chrome for Testing 116 (27 tests; the 2-minute large-history test excluded as it is unchanged and engine-independent). GitHub CI not yet run on this branch.

## Implemented
- **Settings page** (`settings.html`, linked from the search footer and onboarding): index summary and usage meter; pause/resume (also stops the import cleanly; toolbar badge `II`); mirrored-deletion toggle; retention (3/6/12/24 months/until deleted); storage limit (250 MB–5 GB); Deep Search (permission status, enable/disable, exclusions, delete Deep text); **ledger** (per-site pages/text/last activity with Exclude and Delete, and "what is stored for this page" with a 600-character preview); **delete controls** (page, site (+ remembered pages option), date range, all-but-remembered, everything; inline two-step confirm; wholesale deletes need typing `DELETE`); **export/import** of remembered items or everything as a local JSON file (strict schema, ≤ 50 MB, data only); shortcuts (current binding or "not set", link to Chrome's shortcuts page); About/privacy facts and "Copy diagnostics" (counts and settings only).
- **Pipeline/state** (ADR-015): `settings` in `br:state` with defaults; `sw/settings-get|set`; pause semantics (live sync, import, reconcile alarm and Deep capture stop; resume reconciles the gap; restart stays paused); mirrored-deletion off ignores `onVisitRemoved`; maintenance reads retention/cap from settings.
- **Engine**: read-only `domainStats` and `pageInfo` (no schema change).
- **Onboarding polish**: what it does, local-first/no-encryption statement, why the History permission, Deep Search as separate and optional, how to search (live shortcut) and Remember; after consent the same guidance plus links to Settings and Search.
- **Bug found and fixed during the audit**: a live-visited page was indexed with an EMPTY title (Chrome reports `onVisited` before the title exists) and stayed untitled until the daily reconcile. Now one `br-title-refresh` one-shot alarm (≈30 s, not reset by further visits) re-reads the last 20 minutes of history; verified end to end.
- **Privacy/transparency docs**: `docs/PRIVACY-POLICY.md` (draft), `docs/PERMISSIONS.md`, `docs/THREAT-MODEL.md`, ADR-007 (no encryption, no claim), ADR-015; `tests/policy.test.ts` checks PERMISSIONS.md against the manifest (permissions, optional hosts, web-accessible resource, CSP) and the policy's key claims.
- **Release docs**: `docs/RELEASE-CHECKLIST.md` (blockers, manual tests, store work).

## Tests
Unit **336/336** (new `tests/settings.test.ts` 15 tests: settings schema/defaults/legacy state/patch validation/message gate; pause, resume gap, pause during import, restart while paused; mirroring on/off; retention/cap from settings; ledger queries; delete range/site/saved semantics; export→import round trip and malformed-file rejection; title-refresh; `tests/policy.test.ts` 4). e2e **29/29** Chromium 141 incl. `e2e/settings.spec.ts`: onboarding disclosures + axe; settings axe; pause/resume with badge; persisted preferences across reload; shortcuts; ledger and page lookup; every delete flow incl. confirm steps and case-sensitive type-to-confirm, remembered items surviving; integrity ok; export → delete everything → import round trip, bad/malformed files rejected with nothing imported; diagnostics contain no URLs/titles/text; overlay-frame axe; a recorder over the whole scenario (≥ 20 requests seen, none outside the extension and the local fixture server); live-visit title refresh. Existing pipeline e2e copy assertion updated for the new onboarding text. Chrome 116: settings, overlay, search-ui, foundation, deep-search, remember, pipeline, engine specs pass (27). typecheck, lint (`--max-warnings 0`), eval 1/1, built-output 5/5, `npm audit --omit=dev` 0.
Accessibility: axe (serious/critical) clean on onboarding, search, overlay frame and settings; keyboard-operable (native controls, two-step confirm uses focus). Manual screen-reader pass is on the checklist.

## Size
JS 163.5 kB gz (was 156.25 after M7), all files 575.1 kB. Growth: settings page chunk ≈ 4.5 kB gz, onboarding/search/messages ≈ 2 kB, shared schemas ≈ 1 kB, all real product functionality (no new dependency). **JS budget raised 160 → 175 kB** (headroom 11.5 kB); total budget unchanged at 620 kB (headroom 45 kB). No obvious waste found (engine worker 103 kB gz is SQLite wrapper + engine).

## Deviations / honest limits
- Settings are one page with sections (not tabs); "Ledger" is inside Settings (top 25 sites), not a separate screen. "Four onboarding screens" are sections on one page.
- No per-domain pause, dwell time or custom date picker beyond native date inputs (not in V1 scope).
- The retention/cap choices apply at the next daily cleanup (stated in the UI).
- Real Chrome optional-permission prompt, shortcuts on Windows/macOS and the real-site overlay matrix are owner manual tests (checklist B–D).
- Extension icons do not exist yet (release blocker A1).

## Release readiness audit
BLOCKERS BEFORE SUBMISSION: icons; manual real-Chrome tests (permission prompt, shortcuts, overlay matrix, package smoke test); privacy policy completion + public URL + contact; store listing text/assets/name check; dashboard declarations (single purpose, justifications, data disclosures, remote code, trader status).
NON-BLOCKING / POST-V1: localisation; per-page "never index"; dwell/SPA capture; passphrase encryption; Edge/Brave; real-site overlay failures (window fallback exists).
No functionality, permission or known-bug blockers were found: permissions equal the documented set, production manifest has no host permissions/content scripts, the zip is clean, privacy claims match code and are test-pinned.
