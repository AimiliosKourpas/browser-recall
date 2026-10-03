# Handoff (after M1)

**State:** M0 done (G0 conditional pass, merged). M1 done on branch `claude/m1-foundation`, awaiting owner review/merge. Report: `docs/milestones/M1-RESULTS.md`. **Do not start M2 without owner approval.**

## Read first (in order)
1. `docs/milestones/M1-RESULTS.md` (what exists, how to run it, A1–A7 status)
2. `docs/spikes/M0-RESULTS.md` (measured evidence; overrides the blueprint) and `docs/adr/`
3. The M2 section of `BROWSER_RECALL_MASTER_BLUEPRINT.md` (IMPLEMENTATION_PLAN §3 M2)

## Commands
`npm ci` · `npm run check` (typecheck+lint+unit+build+built tests+size; ~15 s) · `xvfb-run -a npm run e2e` (~10 s) · `CHROMIUM_PATH=<chrome> …` to test another build · `cd spikes && npm ci` for the M0 spikes.
Local minimum-Chrome check: download Chrome for Testing 116.0.5845.96 from `storage.googleapis.com/chrome-for-testing-public/…` (reachable from the cloud sandbox; developer.chrome.com is NOT).

## Architecture in one paragraph
`src/manifest.ts` is the single manifest source (allowlisted by tests). SW (`src/background`) is a stateless router: `acceptMessage` (zod + sender trust, decided synchronously) → `routeMessage` → `engine-client` (ensure offscreen via `offscreen-manager`, send `engine/ping`, retry transient failures with backoff). Offscreen page (`src/entrypoints/offscreen`) owns a `WorkerClient` for `engine-worker.js` (unlisted script from `src/engine/worker-main.ts`); the worker validates requests with `src/engine/contract.ts` and answers via `src/engine/handlers.ts`. UI is Preact (`src/ui`), strings via `_locales` + `src/shared/i18n.ts`.

## M2 starting points (do not repeat research)
- Extend `engineRequestSchema` / `EngineResults` / `handlers.ts` / `WorkerClient.call` (currently typed for `ping` only — generalise the result typing per method) with SearchStore methods. The worker is the single DB owner.
- **Implement M0 amendments A1/A2/A3/A5(policy)/A6/A7 in the engine**: TypeScript snippets; contentless FTS (`content='', contentless_delete=1`, `prefix='3'`, original text in `contents`, `fold()` = NFD → strip `\p{M}` → lowercase on index AND query); `open()` retry/backoff around `installOpfsSAHPoolVfs` (~2 s worst case; `retryWithBackoff` and `isTransientMessagingError` already exist and are tested; add the OPFS-handle error pattern); `incremental_vacuum` maintenance; non-http(s) URL filter; port `spikes/engine/deletion-policy.ts` (85-day expiry guard) with its tests. Reference code: `spikes/engine/fts-store.ts`, `engine.test.ts`.
- Load `sqlite3.wasm` from a `public/` asset with explicit `locateFile` (classic worker, `chrome.runtime.getURL`); module-worker `import.meta.url` did not work from an HTML entrypoint under WXT (ADR-009). Re-baseline `size-limit` (sqlite ≈0.9 MB).
- Re-run the `compat-minimum-chrome` CI job after adding sqlite/OPFS (ADR-011) — if sahpool fails on 116, raise `MINIMUM_CHROME_VERSION`.
- Keep `src/engine` free of `chrome.*` (lint-enforced). Synthetic corpus + relevance eval harness are M2 deliverables (`spikes/shared/corpus.ts` is a good start).

## Gotchas
- Playwright keeps a DevTools session on the SW: natural idle termination never happens in e2e; use CDP `ServiceWorker.stopWorker` (see e2e test).
- `history.addUrl` takes only `{url}`; seed old history by writing the History SQLite DB with the browser closed (`spikes/browser/seed-history.py`).
- `pkill -f <pattern>` inside a Bash call can kill your own shell; use `pkill -x`.
- Rollup prints noisy zod "annotation" warnings during `wxt build`; harmless.
- Dev-dependency `npm audit` advisories (web-ext transitive) are known; prod audit is clean and CI-gated.

## Owner actions still open (agents cannot do these)
Chrome Web Store developer account + unlisted draft upload (record banner text/privacy checkboxes); demand conversations; Windows/macOS shortcut check; ADR-007 (encryption) question to store support; confirm the licence (MIT placeholder added in M1) and the public product name (still "Browser Recall" — trademark/store collision check); confirm CI is green on GitHub (workflows were validated locally only).
