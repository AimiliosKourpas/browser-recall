# Handoff (after M2)

**State:** M0 done (G0 conditional pass), M1 merged, **M2 done on branch `claude/m2-engine`, awaiting owner review/merge** (GitHub CI for it not yet run). Reports: `docs/milestones/M2-RESULTS.md` (read first), `M1-RESULTS.md`, `docs/spikes/M0-RESULTS.md`. **Do not start M3 without owner approval.**

## Read first (in order)
1. `docs/milestones/M2-RESULTS.md` (engine, API, measured numbers, risks, what M3 needs)
2. ADR-002 (M2 record), ADR-012 (model/protocol/semantics), ADR-006 (deletion/expiry), ADR-011 (min Chrome), then the M3 section of `BROWSER_RECALL_MASTER_BLUEPRINT.md`

## Commands
`npm ci` · `npm run check` (typecheck, lint, unit, eval, build, built checks, size; ≈ 40 s) · `xvfb-run -a npm run e2e` (13 tests, ≈ 45 s; `CHROMIUM_PATH=<chrome>` for another build) · `npm run test:perf` (20K pages, ≈ 90 s) · `EVAL_WRITE=1 npm run test:eval` regenerates the eval baseline · `cd spikes && npm ci` for M0 spikes.
Chrome for Testing 116: `storage.googleapis.com/chrome-for-testing-public/116.0.5845.96/linux64/chrome-linux64.zip` (reachable from the sandbox; developer.chrome.com is not).

## Architecture in one paragraph
UI → `engineCall()` (`src/shared/engine-api.ts`) → SW (`acceptMessage` zod+sender gate, `routeMessage`, `engine-client` with retry of `engine-unavailable`/channel-closed) → offscreen (`WorkerClient`) → `engine-worker.js` (`src/engine/worker-main.ts`: validates, serialises calls, lazy OPFS open with bounded retry, not caching failures) → `SearchStore` (`src/engine/store.ts`, the only SQL) on SQLite WASM + OPFS sahpool. `src/engine` has no `chrome.*` (lint). 19 typed methods in `src/engine/contract.ts`.

## M3 starting points
- Use `upsertHistory` with batches ≤ 1,000 rows (the worker serialises calls; bigger batches block searches). Non-http(s) are skipped by the engine already (summary has `skipped`).
- Deletion mirroring: engine has `deleteUrls/deleteAllExceptSaved/deleteRange`. The ADR-006 expiry guard (ignore removals of URLs whose stored last visit is > 85 days old unless `allHistory`) needs the stored last visit: **add a `lastVisits(urls)` engine method** (read-only, returns `{url,lastVisit}[]`) and port `spikes/engine/deletion-policy.ts` + tests into `src/` (SW side, pure).
- Wire daily `chrome.alarms` → `maintenance`, `applyRetention`, `enforceCap`; schedule `integrityCheck` rarely (≈ 5 s at 20K).
- Back-fill: `history.search({startTime:0})` windows (M0 S8: 7-day windows, large maxResults, ≈ 40 s for 100K into the engine); skip `chrome-extension://` rows (they appear in history).
- First thing to measure in the browser with real data: memory and 20K latency (not re-measured in M2).
- `engineCall` results are typed but unchecked at runtime on the UI side; the SW/worker validate inputs.

## Gotchas
- `PRAGMA incremental_vacuum(N)` must be stepped (prepared statement), not `exec`'d.
- Size accounting is UTF-8 bytes (`stats().textBytes`): Greek is 2 bytes/letter.
- `fold()` maps ς→σ; always fold query tokens with the same function (the parser does).
- The engine worker is a classic WXT unlisted script; `sqlite3.wasm` is copied by the `build:publicAssets` hook in `wxt.config.ts`.
- Playwright keeps the SW alive: stop it with CDP `ServiceWorker.stopWorker`; close the offscreen doc with CDP `Target.closeTarget` (both used in `e2e/engine.spec.ts`).
- `pkill -f <pattern>` inside Bash kills your own shell: use `pkill -x`.
- Rollup prints noisy zod "annotation" warnings during `wxt build`; harmless.
- Dev-dependency `npm audit` advisories (web-ext transitive) are known; prod audit is clean and CI-gated.

## Owner actions still open (agents cannot do these)
Chrome Web Store developer account + unlisted draft upload (record banner text/privacy checkboxes); demand conversations; Windows/macOS shortcut check; ADR-007 (encryption) question to store support; confirm the licence (MIT placeholder) and the public product name; confirm GitHub CI is green for M2 (new `engine-perf` job runs on main/manual only).
