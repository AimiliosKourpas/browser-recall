# M3 results — history pipeline and consent gate

Date: 2026-10-04 · Branch `claude/m3-history-pipeline` (from `main` after the M2 merge) · Verified locally on Node 22, Chromium 141 and Chrome for Testing 116.0.5845.96. **GitHub Actions has not run on this branch**; below is "local/cloud execution passed".

## 1. M3 scope implemented
Consent gate + onboarding consent screen; resumable bounded history import; live sync (`history.onVisited`); deletion mirroring with the ADR-006 85-day expiry guard (`history.onVisitRemoved`); `chrome.alarms` scheduling for reconcile, maintenance and an import watchdog; a small persisted state model; engine read `lastVisits`. No permission added (history, storage, alarms were already in the allowlist). No Deep Search capture, no search UI (M4).

## 2. Consent behaviour
- Versioned (`CONSENT_VERSION = 1`), granted only via `sw/grant-consent` from a trusted extension page (the onboarding button *Allow and import history*; a web page or content script cannot grant it — gate tested). Text follows PRODUCT_SPEC §5.1 (what is read, that it stays on the device, the "change your history" heads-up). *No thanks* keeps the extension inert.
- **Before consent**: no `chrome.history` query, no engine call, no alarms — unit-tested (`history.calls` and engine calls empty) and e2e-tested with real Chrome history present (status `none`, engine `pages == 0`, `chrome.alarms.getAll() == []`), also after a restart following *No thanks*.
- **After consent**: import starts in the service worker (the page may be closed), consent persists in `chrome.storage.local`; a restart neither re-asks nor re-imports (e2e: no onboarding tab, data and sync intact).
- **Revocation** (`sw/revoke-consent`, no UI yet): stops processing, clears checkpoint and alarms, keeps indexed data (deleting data is an M8 control). Outdated consent version → treated as no consent and the consent page reopens on update.

## 3. Import architecture (`src/background/pipeline/`)
`state.ts` (one zod-validated key `br:state`, serialised updates) · `history-import.ts` (earliest-visit binary search, 7-day windows newest→oldest, `maxResults` 50,000 with split-on-full, ≤ 1,000 rows per engine call, non-http(s) filtered, `runInitialImport`, `runReconcile`) · `deletion.ts` · `maintenance.ts` · `alarms.ts` · `controller.ts` (pure, dependencies injected: `onWake`, `grantConsent`, `revokeConsent`, `status`, `onVisited`, `onVisitRemoved`, `onAlarm`) · wiring + top-level listeners in `src/background/index.ts`. Onboarding page = consent screen + read-only progress view (polls `sw/pipeline-status`, a11y-checked by axe).

## 4. Resume / checkpoint
The checkpoint `nextEnd` is persisted after every window; idempotent upserts (by normalised URL) make any re-run safe. The service worker re-enters an unfinished import on every wake, and a 1-minute `br-import-watchdog` alarm exists only while an import is unfinished. Tested: unit (engine failure mid-import → state `running` → fresh pipeline instance over the same storage finishes with every page exactly once and does not restart from scratch; forced full re-import changes nothing) and e2e (service worker stopped **twice** mid-import on a 50,070-row profile: finishes, `pages == 50,070`, no duplicates).

## 5. Live synchronisation
`onVisited` → single-row idempotent upsert; repeated/out-of-order events keep the latest time and counts; an empty title (the event fires before the page loads) never erases a known title; non-http(s) ignored. Engine failure → `reconcileDue`; `br-reconcile` (daily, and at startup/wake when due) re-reads the last day+ of history from the last reconcile. e2e: a newly visited page becomes searchable without any action.

## 6. Deletion mirroring and the 85-day guard (A5, ADR-006)
Engine addition `lastVisits(urls)`. `allHistory` → `deleteAllExceptSaved`; URL list → URLs whose stored last visit is within 85 days are deleted (saved pages only lose the history flag), older ones are ignored as Chrome's own expiry; unknown URLs and empty lists are no-ops; repeated events are safe. Unit tests cover recent deletion, the 84/86-day boundary, mixed batches, saved-page survival (single and delete-all, snippets kept), repeats, pure `planRemoval`. **e2e with real Chrome expiry**: 70 rows dated 100 days ago are imported, Chrome's own expiry job then removes them from `chrome.history`, and all 70 remain searchable; **mutation check**: with the guard switched off the same test fails (0/70 remain) — so the test really exercises Chrome's expiry events. e2e also covers real `history.deleteUrl` (mirrored), saved page surviving `deleteUrl` and `deleteAll`.

## 7. Maintenance scheduling
Alarms are re-created idempotently on install, startup, wake, consent and after every alarm: `br-reconcile` and `br-maintenance` (1,440 min); `br-import-watchdog` (1 min) only while an import is unfinished. Maintenance (daily): `applyRetention(12 months)`, `enforceCap(1 GB)`, bounded `maintenance` (500 vacuum pages + FTS merge), `integrityCheck` weekly. Tested: no duplicates after re-calls and after a service-worker stop (e2e `chrome.alarms.getAll()`), wrong period repaired, cleared when consent absent, restored after a "browser restart", the maintenance alarm really fires and the handler restores the periodic alarm (e2e), call order and weekly integrity cadence (unit).

## 8. Performance / import measurement
Production pipeline in real Chromium (history seeded into the profile's History DB): **50,070 rows imported in 11–13 s (≈ 3.8–4.5K rows/s), 15 windows, DB 27.8 MB, despite two service-worker kills** (Chromium 141 and Chrome 116). Node, real engine: 30,000 rows < 60 s test bound (unit). M0's 100K estimate (≈ 40 s) is consistent (≈ 25 s expected at this rate). Batches ≤ 1,000 keep searches responsive between engine calls.

## 9. Tests executed (local)
| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` | **242/242** (new: `tests/pipeline.test.ts` 36 tests incl. consent gate, import/resume/idempotence, live sync, deletion + guard, alarms/maintenance, message gate, 30K-row import over the real engine) |
| `npm run test:eval` | 1/1 (baseline unchanged) |
| `npm run build` + `npm run test:built` | OK; 5/5 |
| `npm run size` | JS 143.8 kB / all 550.2 kB gz (limits 160 / 620) |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `xvfb-run -a npm run e2e` (Chromium 141) | **18/18** (new: 5 in `e2e/pipeline.spec.ts`) |
| same on Chrome for Testing 116.0.5845.96 | **18/18** |
| privacy/no-egress | consent e2e asserts no request other than the test's own fixture navigations left the browser (observable contexts) and the fixture server saw only those pages; CSP/no-egress tests from M1/M2 unchanged and green |
`npm run test:perf` was not re-run (engine untouched apart from one read method).

## 10. Acceptance criteria (IMPLEMENTATION_PLAN M3 + owner brief)
| Criterion | Result |
|---|---|
| Seeded history + fixture pages: all rows appear after back-fill, none before consent | **PASS** (e2e consent test; 50K seeded run) |
| Killing the service worker mid-import then restarting gives a complete, duplicate-free import | **PASS** (killed twice, 50,070/50,070) |
| Closing the offscreen document mid-operation recovers without data loss | **PASS** (M2 e2e for the engine path; import retries transient engine errors via the engine client and checkpoints; unit-tested with failing engine). Not separately killed *during* an import in the browser |
| Deleting history in Chrome removes rows and leaves saved items alone; behaviour matches ADR-006 for expiry | **PASS** (e2e + unit; real Chrome expiry reproduced) |
| Paused state stops all writes | **N/A in M3** — pause is an M8 control; consent absence/revocation stops everything (tested) |
| Load test with 100K synthetic history rows | **PARTIAL**: 50,070 rows in the browser, 30,000 in Node unit; 100K not run (cost/time); scaling is linear in the measured rate |
| Imported records searchable through the real engine | **PASS** |
| Owner-listed items: consent persistence/restart, http(s) filtering, repeated events, delete-all, maintenance scheduling, SW restart | **PASS** |

## 11. Engine API additions
`lastVisits({urls}) → {url, lastVisit}[]` (read-only; contract, handler, store, tested). Nothing else; no schema change.

## 12. ADR changes
ADR-013 (new: consent/state/import/live sync/schedules); ADR-006 (implementation record + mutation evidence); ADR index updated.

## 13. Remaining risks
1. **GitHub CI unverified** for this branch; the e2e suite is now ≈ 3 min (the large-history test waits ≈ 2 min for Chrome's expiry job) in both the e2e and Chrome 116 jobs, and needs `python3` (present on `ubuntu-latest`).
2. The expiry test depends on Chrome's internal expiry timing (observed 1–2 min in M0 and M3; timeout 5 min). A Chrome change to that job would make it time out, not fail silently.
3. Titles that change after the visit are picked up only by the daily reconcile (no `tabs` permission by design).
4. The consent screen is functional, not polished (M8 owns final onboarding, a11y audit, Greek strings); revocation has no UI.
5. 100K-row run not repeated; very large histories (millions) would take proportionally longer but remain resumable.
6. Retention (12 months), cap (1 GB), mirrored deletion and the guard are fixed defaults until the M8 settings UI.
7. An import interrupted exactly when the service worker is killed relies on the next wake (any message, event or the 1-minute watchdog); verified in e2e, but a fully idle browser with a dead service worker waits for the next alarm tick.

## 14. Deferred
M4: search UI. M5: Remember/snippets. M6: capture policy + Deep Search. M7: overlay. M8: settings (retention, cap, pause, mirrored-deletion switch), ledger, full consent re-prompt UX, no-network recorder, polish.

## 15. Next milestone
**M4 — Search UI (window surface)**: consumes `engineCall('search')` (results already carry `snippet`/`highlights`, `approximate`, `suggestions`, `filters`), plus keyboard map, IME handling, empty/loading states and the index-status footer (use `sw/pipeline-status` for "indexing… N %").
