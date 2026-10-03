# M1 results — production foundation

Date: 2026-10-03 · Branch `claude/m1-foundation` (from `main` after the M0 merge) · Verified on Chromium 141 (Playwright build) and Chrome for Testing 116.0.5845.96, Linux, Node 22.

## 1. Executive summary
The production skeleton exists and is exercised end to end: a WXT/TypeScript(strict)/Preact MV3 extension whose service worker (stateless router) creates an offscreen document that hosts an engine worker; search and onboarding stub pages; typed, validated messaging with sender trust checks; i18n scaffold; a locked CSP and a permission allowlist enforced by tests; ESLint bans on network APIs, eval and unsafe DOM writes (with tests proving each ban fires); Vitest unit tests (62), Playwright e2e (8, headed Chromium, persistent context, fixture server, axe), built-bundle checks, size budget, and GitHub Actions (verify, e2e, minimum-Chrome compat, audit, CodeQL). A clean `npm ci && npm run check` and `xvfb-run -a npm run e2e` pass; the e2e suite also passes on Chrome 116 (ADR-011). The one thing not verified is the GitHub-hosted CI itself (no GitHub Actions runner in the sandbox).

No search engine is built (M2). No overlay (M7). No history reading or consent (M3). Nothing dead was added "for the future" except the engine contract/RPC seam that M2 extends and that is exercised by ping today.

## 2. Exact M1 scope implemented (IMPLEMENTATION_PLAN §3 M1)
- Scaffold WXT + TS strict + Preact, layout per ARCHITECTURE §12 ✅ (`src/{background,engine,shared,ui,entrypoints}`; `capture/` deferred to M3/M5, not created empty).
- Manifest with permission allowlist and CSP ✅ (`src/manifest.ts`).
- Lint bans: fetch, XMLHttpRequest, WebSocket, sendBeacon, eval, new Function, innerHTML, dangerouslySetInnerHTML, remote URL imports ✅ (plus EventSource, WebTransport, importScripts, outerHTML, insertAdjacentHTML, document.write, string timers, javascript: URLs, computed/URL `import()`, remote/computed Worker URLs, `chrome.*` in the pure core).
- Typed message layer with schema validation ✅ (zod; sender id + extension-origin URL checks).
- Stub service worker, offscreen document, search page, onboarding page ✅.
- Vitest ✅; Playwright fixture (persistent context, extension-id discovery) ✅; local fixture server ✅; axe-core ✅.
- GitHub Actions: lint, typecheck, tests, build, snapshot tests, size limit, e2e under xvfb, dependency audit, CodeQL ✅ (authored; run locally, not on GitHub).
- i18n scaffold ✅; licence (MIT placeholder, owner to confirm), README, CONTRIBUTING, SECURITY, issue/PR templates, ADR template, CHANGELOG, HANDOFF ✅.
- ADRs 004, 005, 008, 009, 010 recorded ✅; ADR-003/011 updated.
- Added beyond the list because the owner asked: minimum-Chrome (116) compat job and local verification (ADR-011).

## 3. Production architecture
```
UI page (search/onboarding)  --runtime message {type:'sw/…'}-->  Service worker (stateless router)
                                                                   acceptMessage: zod + sender is our extension page
                                                                   engine-client: ensure offscreen, send, retry transient errors
SW --runtime message {target:'engine', type:'engine/ping'}--> Offscreen document (reason WORKERS)
                                                                   WorkerClient: ready handshake, ids, timeouts, death → EngineInterruptedError
Offscreen --postMessage {id, method}--> Engine worker (single owner of engine state; DB arrives in M2)
                                          validates with engineRequestSchema; pure handlers
```
Properties: SW holds no durable state (e2e: engine instance survives a forced SW stop); every cross-context message is parsed with zod and sender-checked; unanswered/untrusted messages never keep a channel open (`acceptMessage` decides synchronously before `return true`); a dead worker rejects all in-flight calls instead of hanging; the SW re-checks offscreen existence on every retry attempt (A3 seam).

## 4. Important files
| Path | Responsibility |
|---|---|
| `src/manifest.ts` | single source of the manifest: permissions, optional hosts, CSP, command, min Chrome |
| `wxt.config.ts` | WXT config (srcDir, Preact JSX, manifest from `src/manifest.ts`) |
| `src/entrypoints/` | thin WXT entrypoints: `background.ts`, `offscreen/`, `search/`, `onboarding/`, `engine-worker.ts` (unlisted worker script) |
| `src/background/` | `index.ts` (listeners, top-level), `router.ts`, `engine-client.ts`, `offscreen-manager.ts` |
| `src/engine/` | pure core, no `chrome.*`: `contract.ts` (schemas/types), `handlers.ts`, `worker-main.ts`, `worker-client.ts` |
| `src/shared/` | `messages.ts` (schemas, sender trust), `retry.ts`, `errors.ts`, `i18n.ts` |
| `src/ui/` | Preact pages + `styles.css` (light/dark custom properties, reduced motion) |
| `public/_locales/en/messages.json` | message catalogue |
| `eslint.config.js` | privacy/security bans |
| `tests/` | unit tests incl. `lint-rules.test.ts`, `manifest.test.ts`; `tests/built/` checks the built output |
| `e2e/` | Playwright fixtures, fixture server, `foundation.spec.ts` |
| `.github/workflows/` | `ci.yml` (verify, e2e, compat-minimum-chrome, audit), `codeql.yml` |
| `spikes/` | M0 code, now its own npm package (own lockfile), excluded from lint/CI |

## 5. Manifest and permission decisions
Permissions exactly per ADR-001/blueprint §3: `history, storage, unlimitedStorage, contextMenus, activeTab, scripting, offscreen, alarms`. `optional_host_permissions: https://*/*, http://*/*` (Deep Search, requested at runtime from a gesture — never `host_permissions`). No `content_scripts`, no `web_accessible_resources` (added in M7 with `use_dynamic_url`, ADR-003), no `externally_connectable`. `minimum_chrome_version: 116`. Command `open-search`: Ctrl+Shift+Y / Command+Shift+Y (provisional, M0 S7). Chromium reports **0 manifest errors, 0 install warnings**. Note: most permissions are not *used* yet (history M3, contextMenus/activeTab/scripting M5, alarms M3, storage M3); they are declared now because the allowlist is the accepted design and the snapshot test fixes it. If store review objects to an unused permission before its milestone, remove it from `PERMISSIONS` and the allowlist together.

## 6. Privacy/security enforcement
1. Locked extension CSP (`connect-src 'none'`, no inline/eval, no remote origins) — asserted by unit test on the string, by the built-manifest test, and by an e2e probe (fetch/sendBeacon/Image to a recording server from the search page: fetch rejected, **0 requests received**).
2. ESLint bans (list in §2) in `src`, `tests`, `e2e`; 20 rule tests + no-false-positive tests; mutation checks done by hand (see §8).
3. Built bundle scan: every `http(s)://` string in output JS/HTML/CSS must match a tiny allowlist (w3 namespaces, zod's JSON-Schema identifiers) and no `eval(`/`new Function(`; HTML has no inline scripts/handlers/remote refs.
4. Manifest allowlist test: permissions equal the list; forbidden permissions (`tabs`, `webRequest`, `cookies`, `bookmarks`, `downloads`, …) absent; no required hosts/content scripts.
5. Sender trust: only our own extension pages can drive the SW (`id` + `chrome-extension://<id>/` URL); the offscreen document only answers `engine` messages from our extension.
6. e2e confirms the extension does not touch ordinary web pages in M1.
Not yet: the full-scenario request recorder across all contexts and injected scripts (M8).

## 7. Tooling/build/test setup
Node 22, **npm** (see deviations), WXT 0.20.27, Vite 7, TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), Preact 10, zod 4, Vitest 3, Playwright 1.56.1 (matches the sandbox Chromium), ESLint 9 flat config + typescript-eslint, size-limit. Scripts: `dev, build, zip, typecheck, lint, test, test:built, size, e2e, check`.

## 8. Tests and commands executed (all on a clean `rm -rf node_modules .output .wxt && npm ci`)
| Command | Result |
|---|---|
| `npm ci` | OK; `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `npm test` | **62/62** (retry, messages/sender trust, offscreen manager, engine client recovery, worker + WorkerClient, i18n catalogue, manifest allowlist/CSP, lint rules) |
| `npm run build` | OK, 205 kB unzipped, **zip 65.5 kB** |
| `npm run test:built` | 5/5 |
| `npm run size` | JS 61.0 kB gzip (limit 70), all files 63.5 kB (limit 90) |
| `xvfb-run -a npm run e2e` (Chromium 141) | **8/8** |
| `CHROMIUM_PATH=<Chrome for Testing 116.0.5845.96> xvfb-run -a npm run e2e` | **8/8** |
| mutation: add `'tabs'` to permissions | `manifest.test.ts` fails (2 tests) |
| mutation: add `host_permissions` | `manifest.test.ts` fails |
| mutation: `fetch(...)` in a new `tests/*.test.ts` | ESLint error (`no-restricted-globals`), file removed |
| `cd spikes && npm ci && tsc && vitest` | M0 spikes still typecheck, 25/25 |
| YAML parse of workflows | OK (not executed on GitHub) |

## 9. Acceptance criteria
| Criterion | Result |
|---|---|
| Clean checkout builds and loads in Chromium; e2e opens the stub search page and the SW creates and reaches the offscreen document | **PASS** (clean `npm ci`; e2e: engine ready status, `getContexts` = 1 offscreen, `sw/ensure-engine` → `{ok, protocol:1}`; also on Chrome 116) |
| Manifest permission allowlist snapshot test fails if any permission or host pattern is added | **PASS** (shown by mutation) |
| Introducing a banned API in a test file makes lint fail | **PASS** (shown by mutation; also `tests/lint-rules.test.ts`) |
| CI is green on a fresh clone with cached dependencies | **NOT VERIFIED on GitHub / PARTIAL**: workflows authored and YAML-valid; every job's commands pass locally from a clean install. First GitHub run may reveal runner-specific issues (apt packages for the Chrome 116 job, `playwright install --with-deps`). |
| Tests required: lint-rule tests, snapshot tests, e2e smoke, CI dry run | lint-rule ✅, snapshot ✅, e2e smoke ✅, CI dry run = local equivalent only |

## 10. Deviations from the blueprint
1. **npm instead of pnpm** (not installed; fewer moving parts) — ADR-009.
2. **Engine worker is a classic unlisted-script worker**, not a module worker via `new URL(import.meta.url)` — WXT did not emit it from an HTML entrypoint — ADR-009.
3. **`capture/` directory not created** (M3/M5 own it); empty folders are dead structure.
4. **zod is bundled in both the SW chunk and the worker (~30 kB gzip each)** — accepted; the budget is re-baselined in M2.
5. Added minimum-Chrome compat CI job and Chrome 116 verification (owner request; advances ADR-011).
6. MIT licence added as a placeholder; the licence is a [DECIDE] owner item.
7. Tested with Chromium 141 headed under xvfb (as M0); Playwright cannot press real shortcuts or click the toolbar, so the popup-window open path is only reachable through the `sw/open-search` message in tests (and is not asserted yet — M4 owns the search window UX).

## 11. Remaining risks
- GitHub CI unverified (see above). The Chrome 116 job installs extra apt libs; if a package name differs on `ubuntu-latest` it will need a tweak.
- Dev-dependency `npm audit` advisories (web-ext transitive: adm-zip, node-forge, shell-quote, tmp, uuid, a vitest/esbuild range) — build-time only, nothing ships; revisit when WXT updates.
- Declared-but-unused permissions between milestones (see §5).
- `WorkerClient.call`/contract are typed for `ping` only; M2 must generalise per-method result typing (noted in HANDOFF) — small, but easy to get wrong with `any`, which lint forbids.
- Popup-window search surface and `open-search` shortcut are untested end to end (M4).
- Shortcut default and Windows/macOS conflicts still unverified (M0 S7).
- ADR-011 is verified on 116 only for the M1 feature set; sqlite/OPFS on 116 is unknown until M2.

## 12. M0 amendments A1–A7
| # | Amendment | Status |
|---|---|---|
| A1 | Snippets in TypeScript | **Deferred to M2** (engine). Reference `spikes/engine/fts-store.ts`. Nothing in M1 uses FTS5 `snippet()`. |
| A2 | FTS5 contentless, `contentless_delete=1`, `prefix='3'`, TS fold (NFD→strip marks→lowercase), opfs-sahpool, offscreen worker, MiniSearch fallback only | **Architecture incorporated now** (offscreen-hosted single-owner worker, contract seam, ADR-009 WASM notes); **engine/fold deferred to M2**. `src/engine` is `chrome`-free so M2 logic is Node-testable. |
| A3 | Offscreen/OPFS reopen tolerates delayed handle release; callers recover from interrupted in-flight messages | **Incorporated now** for the messaging layer: `retryWithBackoff`, `isTransientMessagingError`, `EngineInterruptedError`, SW re-ensures offscreen on every attempt, `WorkerClient` rejects in-flight calls on death — all unit-tested. **OPFS-open retry deferred to M2** (no DB yet). |
| A4 | Overlay: host + `popover=manual` + closed shadow + iframe; `body.inert`; focus hand-off; popup fallback | **Deferred to M4/M7** as instructed; ADR-003 updated: no WAR in M1, tests enforce it. Popup window path exists (toolbar click/shortcut). |
| A5 | Deletion mirroring with >85-day expiry guard | **Deferred to M3** (history pipeline); tested prototype in `spikes/engine/deletion-policy.ts`; ADR-006 stands. |
| A6 | Ignore non-http(s) URLs in import/indexing | **Deferred to M2/M3** (URL normalisation / importer). |
| A7 | `incremental_vacuum` maintenance | **Deferred to M2** (DB maintenance routines). |
Also preserved: locked CSP/no-network (enforced), single-owner model (worker is the only engine-state owner), stateless SW (e2e), MiniSearch not used.

## 13. Recommended next milestone
**M2 — Engine core** (2–3 sessions in the plan; the budget-sensible split is: session A = schema/migrations/SearchStore/fold/snippets/URL normalisation/delete ops inside the worker with Node-side tests; session B = query parser/ranking/eval harness/benchmarks and the browser-side OPFS open-retry). Owner can run the Web Store draft upload in parallel; it blocks nothing until M9 planning.

## 14. Budget-conscious handoff
- Do not re-run M0 benchmarks; use `docs/spikes/M0-RESULTS.md`.
- Start M2 from `spikes/engine/fts-store.ts` + `engine.test.ts` (schema, fold, TS snippets, hostile-query tests) and port into `src/engine` with the `SearchStore` interface from ARCHITECTURE §5.4b; sqlite-wasm runs in Node for tests (`@sqlite.org/sqlite-wasm`, add as a dependency in M2).
- The fastest feedback loop: `npm test` (1.5 s) for engine logic; `npm run build && xvfb-run -a npm run e2e` (~25 s) for integration; avoid long browser benchmarks unless a budget regresses.
- Before merging M1: check the first GitHub Actions run and fix runner-specific issues (cheap); confirm the licence and the product name.
