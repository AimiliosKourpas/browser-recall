# Handoff (after M8): NEXT SESSION = RELEASE SESSION

All planned implementation (M0–M8) is done on `claude/m8-settings-release-polish` (stacked on `claude/m7-overlay-integration`); do not start new features. Read `docs/RELEASE-CHECKLIST.md` first: it lists the five BLOCKERS (icons, manual real-Chrome tests incl. the optional-permission prompt, privacy-policy completion/URL/contact, store listing assets + name check, dashboard declarations) and the exact manual test scripts. Then `docs/milestones/M8-RESULTS.md`, `docs/PERMISSIONS.md`, `docs/PRIVACY-POLICY.md` (draft), `docs/THREAT-MODEL.md`, ADR-007/014/015.
Commands: `npm ci` · `npm run check` · `npm run build && npm run build:e2e && xvfb-run -a npm run e2e` (29 tests, ≈4 min) · `npm run zip` (production package, `.output/browser-recall-<version>-chrome.zip`) · `CHROMIUM_PATH=<Chrome 116>` for the compat run. Size budgets: JS 175 kB, total 620 kB (now 163.5 / 575.1).
Settings/messages added in M8: `sw/settings-get|set`, `br:state.settings`, engine `domainStats`/`pageInfo`, alarm `br-title-refresh`.


**M7 done on `claude/m7-overlay-integration`** (see `docs/milestones/M7-RESULTS.md`, ADR-003 record, `docs/qa/overlay-matrix.md`): overlay + window fallback, `sw/open-search {tabId}`, `sw/overlay-close`, WAR for `search.html`. e2e overlay tests need both builds (`npm run build && npm run build:e2e`) and `xvfb-run`. JS size headroom is 3.75 kB.


**M6 done on `claude/m6-deep-search`** (from the M5 branch; see `docs/milestones/M6-RESULTS.md`, ADR-014): Deep Search capture, `settings.html`, `clearDeepContent`, `br:state.deep`. Chain: main → m4-search-ui → m5-remember-saved → m6-deep-search; nothing merged to main. **Before publishing**: manually test the real optional-permission prompt (grant, deny, remove in `chrome://extensions`). Next: M7.

**M5 done on `claude/m5-remember-saved`** (from the M4 branch; see `docs/milestones/M5-RESULTS.md`): Remember / Save selection (context menu, `remember-page` command, `sw/remember-tab`, `sw/save-selection`), extractor v1 (`src/capture/extractor.ts`, reusable by M6), text fragments, `unsavePage`/`deleteSnippet`. **E2E needs both builds**: `npm run build && npm run build:e2e` (the e2e build adds `host_permissions: http://fixture.test/*`; use `launchExtension(dir, {e2e:true})` and `fixtureOrigin(server)`).

**M4 done on `claude/m4-search-ui`** (search UI, see `docs/milestones/M4-RESULTS.md`). The M3 notes below remain valid; the search page is no longer a stub: engine-ready signal is `data-engine-state="ready"` on `<main>`.

# (M3 handoff)

**State:** M0–M2 merged. **M3 done on branch `claude/m3-history-pipeline`, awaiting owner review/merge** (GitHub CI not yet run). Read `docs/milestones/M3-RESULTS.md` first, then M2-RESULTS and ADR-012/013/006. **Do not start M4 without owner approval.**

## Commands
`npm ci` · `npm run check` (typecheck, lint, unit, eval, build, built checks, size) · `xvfb-run -a npm run e2e` (18 tests, ≈ 3 min; the large-history test waits ≈ 2 min for Chrome's expiry job) · `CHROMIUM_PATH=<chrome>` for another build (Chrome for Testing 116: `storage.googleapis.com/chrome-for-testing-public/116.0.5845.96/linux64/chrome-linux64.zip`) · `npm run test:perf` (20K pages, main-only in CI) · `EVAL_WRITE=1 npm run test:eval`.

## What exists now
UI → `engineCall()` → SW → offscreen → engine worker (M2). **History pipeline** (`src/background/pipeline/`, ADR-013): consent gate (versioned, onboarding page), resumable import (7-day windows, checkpoint per window, SW wake + watchdog alarm), live sync (`onVisited`), mirrored deletion with the 85-day guard (`onVisitRemoved`, engine `lastVisits`), alarms (`br-reconcile`, `br-maintenance`, `br-import-watchdog`), one `chrome.storage.local` key `br:state`. UI-facing messages: `sw/pipeline-status` (use for the M4 index-status footer), `sw/grant-consent`, `sw/revoke-consent`, `sw/engine`, `sw/open-search`, `sw/ensure-engine`.

## M4 starting points
- Search page: `engineCall({method:'search', params:{query, now: Date.now(), tzOffsetMinutes: -new Date().getTimezoneOffset()}})`; render `snippet.text` with `snippet.highlights` and `titleHighlights` as text nodes (never innerHTML); show `approximate` results separated, `suggestions` ("Did you mean"), `filters` as chips; stale-response discarding (request counter) and ~30 ms debounce; IME: ignore Enter while composing; open results with `chrome.tabs.create`.
- Index status footer: `sw/pipeline-status` (`importStatus`, `processed`, `progress`) + `stats` engine call.
- If consent is missing the search page should point to the onboarding page (status `consent: 'none' | 'outdated'`).
- Popup-window surface exists (`sw/open-search`, toolbar click, `open-search` command); overlay is M7.

## Gotchas
- e2e history data comes from visiting fixture pages (`e2e/fixtures/gizmo-*.html`) or seeding the profile's History DB with `e2e/support/seed-history.py` (browser closed): `history.addUrl` only takes `{url}`.
- Loading the unpacked extension in an existing profile fires `onInstalled(install)` again: the consent page opens only if consent is missing/outdated.
- Chrome's expiry job needs ~1–2 min after start; `chrome.alarms` do not reliably survive browser restarts (re-created on every wake/startup).
- Playwright keeps the SW alive: stop it with CDP `ServiceWorker.stopWorker`; destroy the offscreen doc with `Target.closeTarget`.
- `pkill -f <pattern>` inside Bash kills your own shell: use `pkill -x`.
- Dev-dependency `npm audit` advisories (web-ext transitive) are known; prod audit is clean and CI-gated.

## Owner actions still open
Chrome Web Store developer account + unlisted draft upload (record banner text/privacy checkboxes); demand conversations; Windows/macOS shortcut check; ADR-007 (encryption) question to store support; confirm the licence (MIT placeholder) and the public product name; confirm GitHub CI is green for M3.
