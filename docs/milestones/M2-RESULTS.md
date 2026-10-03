# M2 results — engine core

Date: 2026-10-03 · Branch `claude/m2-engine` (from `main` after the M1 merge) · Verified locally on Node 22, Chromium 141 and Chrome for Testing 116.0.5845.96 (Linux). **GitHub-hosted CI has not run on this branch**; everything below is "local/cloud execution passed", not "GitHub Actions verified".

## 1. Executive summary
Browser Recall now has its real, persistent, local search engine: SQLite FTS5 (contentless, `contentless_delete=1`, `prefix='3'`) on OPFS-sahpool, owned by a single engine worker inside the offscreen document, reached through a typed, validated protocol (UI → service worker → offscreen → worker) that survives service-worker termination, offscreen-document destruction and a full browser restart. It implements the whole M2 scope: schema + migrations, history/content/saved/snippet writes, deletion semantics, query parser (all documented syntax), URL normalisation, date parsing, ranking, relaxation and "did you mean", TypeScript snippets, bounded maintenance (incremental vacuum), retention and storage-cap routines, export/import, integrity checks, a labelled relevance harness and performance guards.
The mandatory M0 amendments A1, A2, A3, A7 are implemented and tested (A5 policy and A6 are partly engine-side; see §17/§19). Three things M0 did not reveal surfaced and are documented: DB size must be judged in UTF-8 bytes (Greek), `incremental_vacuum` must be stepped to completion, and the TypeScript ranking/snippet stage — not SQLite — dominates latency (still inside budget, but with a thinner margin than M0's SQL-only numbers suggested).
Not done on purpose: no M3 history sync, no M4/M5 UI, no Deep Search capture, no MiniSearch fallback implementation (M0 evidence says it is not needed; the interface keeps the door open).

## 2. Exact M2 scope (IMPLEMENTATION_PLAN §3 M2) and where it landed
| M2 item | Status |
|---|---|
| Schema, migrations (numbered, forward-only) | ✅ `src/engine/schema.ts` |
| SearchStore (SQLite FTS5 per ADR-002) | ✅ `src/engine/store.ts` (MiniSearchStore fallback: not built, see §18) |
| URL normalisation/canonicalisation | ✅ `src/engine/url.ts` |
| Query parser + AST (terms, phrases, exclusion, site:, after:, before:, when:, is:saved, is:snippet) | ✅ `src/engine/search/parser.ts` |
| Date parsing (ISO and relative 7d/2w/3m, plus 1y, when:) | ✅ `search/dates.ts` |
| Ranking with unit-tested components; suggest for typos; relaxation path | ✅ `search/ranking.ts`, `store.ts` |
| Delete operations (URL, domain, range, all-except-saved), retention and cap routines, export and import | ✅ (plus `deleteEverything`) |
| Synthetic corpus generator, benchmark harness, relevance eval harness with an initial labelled query set | ✅ `tests/support/corpus.ts`, `tests/perf/`, `tests/eval/` (`queries.jsonl`, 560 queries), `docs/eval/baseline.md` |
| Engine worker wrapper runnable inside the offscreen document | ✅ `engine-worker.js` + typed protocol |

## 3. Final production engine architecture
```
UI page ──{type:'sw/engine', call}──▶ Service worker (stateless: zod gate + sender trust, ensure offscreen, retry transient)
SW ──{target:'engine', type:'engine/call', call}──▶ Offscreen document (WorkerClient: ready handshake, ids, timeouts, death→EngineInterruptedError)
Offscreen ──postMessage {id, call}──▶ Engine worker  ── single owner ──▶ SQLite WASM (sqlite3.wasm bundled) ── OPFS sahpool ── browser-recall.db
```
The worker validates every request again, serialises calls through one queue, opens the database lazily with bounded retry/backoff (60 attempts, 100→250 ms ≈ 10–15 s worst case, then a typed `EngineOpenError`; a failed open is *not* cached, so the next call retries without a restart), applies `PRAGMA cache_size=-32768`, migrates, and answers with typed results or `{code,message}` errors. `src/engine` has no `chrome.*` (lint-enforced); the engine is unit-tested in Node against the real in-memory SQLite WASM.

## 4. Schema / domain model (v1)
`pages(id, url UNIQUE, domain, title, first_seen, last_visit, visit_count, typed_count, lang, flags[history 1|content 2|saved 4], saved_at, content_hash, content_indexed_at)` · `contents(page_id, headings, description, body, bytes[UTF-8])` · `snippets(id, url, domain, page_title, text, fragment, truncated, created_at)` · `fts_main(title, headings, description, body)` contentless, folded · `fts_meta(title, url)` trigram, folded · `fts_snip(text, page_title)` contentless, folded · `fts_vocab` (fts5vocab) · `meta(schema_version)`. `auto_vacuum=INCREMENTAL` set before the first table. Rationale and exclusions: ADR-012.

## 5. Engine API (`src/engine/contract.ts`, 19 methods, all validated)
`ping`, `upsertHistory`, `upsertContent`, `savePage`, `addSnippet`, `search`, `suggest`, `deleteUrls`, `deleteDomain`, `deleteRange`, `deleteAllExceptSaved`, `deleteEverything`, `applyRetention`, `enforceCap`, `maintenance`, `stats`, `integrityCheck`, `exportData`, `importData`. UI code calls `engineCall(call)` (`src/shared/engine-api.ts`); results are typed by `EngineResults`. No raw SQL leaves `src/engine/store.ts`.

## 6. Search and ranking behaviour
Parse → closed FTS grammar (only quoted `[\p{L}\p{N}]` token groups, `*`, `OR`, bound as a parameter) → bm25 (title 10, headings 4, description 3, body 1) top-200 → TypeScript re-rank `1.0·bm25(rel. to best) + 0.35·titleUrl + 0.25·recency(τ=45 d) + 0.08·log1p(visits) + 0.2·saved + 0.2·phrase`. Last bare word = prefix. Tie-break: score, then recency, then URL (deterministic, tested). Relaxation (<5 exact): any-term then trigram substring, results flagged `approximate`, listed after exact ones. "Did you mean" for unknown words only. Details: ADR-012. Weights are starting values pending the real eval set.

## 7. Text folding (A2)
`fold()` = NFD → strip `\p{M}` → lowercase (+ ς→σ, context-free). Applied to every indexed field and to every query token. M0 had shown that SQLite's `remove_diacritics` does not fold Greek tonos; tests prove the TypeScript fold does (βιβλίο = βιβλιο = ΒΙΒΛΊΟ, ΖΑΧΑΡΩΤΑ found by `ζαχαρωτα`, `ιβλι` found by trigram, Latin `café`/`zürich`), also **after a service-worker restart and a browser restart** (e2e). Known limit (tested): no stemming, so `βιβλίο` does not match `βιβλία` as a whole word; a ≥3-character prefix (`βιβλ`) does.

## 8. Snippets (A1)
`buildSnippet` works on the stored ORIGINAL text, deterministically: token matches found on folded text and mapped back through an offset map, so Greek accents and case are preserved in the output and in the highlight ranges; the window covering the most distinct terms wins (ties → earliest); word-boundary snapping; ellipses; surrogate-pair safe; whitespace collapsed; highlights are offsets (UI renders text nodes). FTS5 `snippet()` is not used anywhere. Tests: start/deep/multi-term/prefix/missing/no-match/Greek/emoji/determinism + a property test (highlights always inside the text).

## 9. Persistence and recovery (A3)
- Same OPFS database across: write → search → **service-worker termination** (CDP `ServiceWorker.stopWorker`; engine instance id unchanged) → **offscreen document destroyed** (`Target.closeTarget`; a *new* engine instance id, same data) → **full browser restart with the same profile**. All in real Chromium 141 and Chrome 116 (e2e `engine.spec.ts`).
- Opening after an abrupt close retries only the "sync access handle still held" error (bounded; unit-tested with the M0 figure of 19 attempts, exhaustion → `EngineOpenError{code:'open-failed', attempts}`, unrelated errors not retried).
- Callers: the service worker retries `engine-unavailable` and "channel closed / receiving end missing"; interrupted writes are safe to repeat (one transaction each, upserts idempotent).
- A database newer than the code throws `DatabaseTooNewError` and is left untouched (tested); a failing migration rolls back completely (tested).
- Not run in M2: SIGKILL mid-write on the production engine (M0 verified the mechanism with identical VFS/pragmas), and a long soak.

## 10. Maintenance / vacuum (A7)
`maintenance({vacuumPages≤5000 (default 500), minFreePages (default 64), ftsMerge})`: bounded `incremental_vacuum`, only when the free list is large enough, plus one bounded FTS merge step on request; designed for a daily alarm (M3 wires it), never per write. Finding: `db.exec('PRAGMA incremental_vacuum(N)')` frees **one** page — the statement must be stepped to completion (implemented with a prepared-statement loop; this was a real bug caught by the test). Tested: churn → free pages; bounded reclaim; file shrinks; data and FTS integrity intact; no-op below the threshold. Also: `enforceCap` (bounded loops: Deep text first, then oldest non-saved pages; saved never removed) and `applyRetention`.

## 11. Performance regression measurements (baseline: M0 S2)
Node, in-memory SQLite, 20K synthetic pages (`npm run test:perf`, 20 % Greek, UTF-8 text 131 MB):
| metric | M2 production engine | M0 baseline (spike, Node 20K) | guard |
|---|---|---|---|
| DB size / text (UTF-8 bytes) | **1.92×** (251.7 MB) | 1.97× (Latin only) | ≤ 2.0× ✅ |
| query p95, distinctive (full pipeline) | 48.7 ms (p50 12.2) | 15.5 ms (SQL + simple snippet) | ≤ 100 ms ✅ |
| query p95, with site + date filters | **12.4 ms** (p50 5.0) | 8.9 ms | ≤ 100 ms ✅ |
| query p95, date filter only | 40.5 ms | – | ≤ 100 ms ✅ |
| query p95, adversarial (stop-word-like) | 120.8 ms (p50 35) | 106 ms | ≤ 300 ms ✅ (known weak spot) |
| ingest, content pages/s (one page per transaction) | 448 | 1,600 (100-page batches) | ≥ 150 ✅ |
| bounded vacuum after churn | file shrinks, free list → 0 | – | ✅ |
| `integrityCheck` at 20K | ≈ 5 s | – | run rarely |
In real Chromium 141 / Chrome 116 (`e2e/engine-perf.spec.ts`, 2K pages through the full UI→SW→offscreen→worker path, prefix-heavy queries): engine time p50 15–17 ms, p95 59–66 ms; round trip p50 21–23 ms, p95 66–72 ms; history ingest ≈ 2.4K rows/s; Deep content ingest ≈ 85 pages/s (one transaction per page on OPFS; fine for live indexing at ≈1 page/s, slow for bulk — batch if M6 ever needs it); DB 27 MB for 12.9 MB of text at 2K pages. **Not re-measured in the browser at 20K**: memory (M0: +61 MB at 20K; the new 32 MB page cache can add up to 32 MB) and 20K latency — see risks.
Honest reading: M0's 15 ms p95 excluded the TypeScript re-rank (200 candidates folded/tokenised) and snippet stage; including them, p95 is ≈ 3× higher but within budget. Optimisations applied during M2: ASCII fast path in `fold`, per-character cache for non-ASCII, one fold per result body shared by snippet and phrase check, cached prepared statements on the write path, capped relaxation work (40 candidates, snippets for the best 10).

## 12. Chrome 116 result
**PASS.** The production engine runs on Chrome for Testing 116.0.5845.96 (UA `Chrome/116.0.0.0` verified): all 13 e2e tests pass (persistence incl. offscreen recreation and browser restart, validation gate, no-egress, performance guard, plus M1 tests). `minimum_chrome_version: 116` stays; ADR-011 updated (overlay/`use_dynamic_url` still unverified until M7).

## 13. Build / package size
M1 budget (pre-engine): 70 kB JS / 90 kB all files (gzip). Now: JS **139.5 kB** gzip, all files **545.4 kB** gzip, zip **545.6 kB**; `sqlite3.wasm` 868.9 kB raw (copied from the npm package by a build hook; bundled, never fetched), `engine-worker.js` 340.8 kB raw (sqlite-wasm glue ≈ 70 kB gz, zod ≈ 30 kB gz in each of two bundles, engine code). New budgets in `package.json`: **160 kB / 620 kB** (≈ 13–15 % headroom). The check stays enabled; the blueprint's "package ≤ 5 MB" target is met with a large margin.

## 14. Security / privacy verification
- CSP unchanged (still `connect-src 'none'`, `wasm-unsafe-eval` only); permission allowlist unchanged (manifest tests pass); ESLint bans unchanged and still green; sender validation extended (all engine messages need a trusted extension page; offscreen answers only our extension; malformed/unknown calls are ignored — e2e proves a `{method:'exec', params:{sql}}` call is dropped).
- Built bundle scan passes with ONE added allowlist entry: a documentation URL string inside sqlite-wasm's error text (`https://sqlite.org/wasm/doc/…`), never fetched. No `eval`/`new Function`.
- **No user text reaches SQL**: (1) the parser emits only folded `[\p{L}\p{N}]` tokens/domains/numbers (property test, 800 runs); (2) every FTS expression matches a closed grammar (property test); (3) a spy over the real engine records every SQL statement during 400 random hostile queries: none contains the query marker, only a bounded set of statement templates occurs, and the database is unchanged afterwards.
- e2e no-egress regression: a busy engine (writes, searches, maintenance) causes no request observable in the browser context or at a recording server; the full-scenario recorder over all contexts remains an M8 deliverable.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities (new runtime dependency: `@sqlite.org/sqlite-wasm`; dev: `fast-check`).

## 15. Tests and commands executed (local)
| Command | Result |
|---|---|
| `npm run typecheck` / `npm run lint` | clean |
| `npm test` | **206/206** (13 files: pure engine incl. parser/dates/URL/fold/snippets/ranking components; store; search semantics; schema/migrations/maintenance/OPFS-retry; property tests; worker + client; engine client; messages; manifest; lint rules; i18n; offscreen manager; retry) |
| `npm run test:eval` | 1/1 — 560 labelled queries, floors enforced (see baseline) |
| `npm run test:perf` (20K pages) | 1/1 (numbers in §11) |
| `npm run build` + `npm run test:built` | OK; 5/5 |
| `npm run size` | 139.5 / 545.4 kB vs 160 / 620 kB limits |
| `xvfb-run -a npm run e2e` (Chromium 141) | **13/13** |
| same with `CHROMIUM_PATH` = Chrome for Testing 116.0.5845.96 | **13/13** |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `cd spikes && npx tsc --noEmit && npx vitest run` | M0 spikes still pass (25/25) |
During development: two real bugs found by tests — `incremental_vacuum` freeing one page per `exec`; min-max bm25 scaling drowning boosts — plus the percent-encoding of non-ASCII URLs in the synthetic labels and Greek final-sigma folding.

## 16. Acceptance criteria
| Criterion | Result |
|---|---|
| Parser: 100 % of documented syntax covered; property tests show no crash and no SQL fragment reaches the database from user text | **PASS** (every form tested incl. invalid-operator-as-literal; properties + SQL spy) |
| Ranking: each component has a focused test; eval baseline hit@1/hit@5/MRR recorded in `docs/eval/baseline.md` | **PASS** (ALL excl. typo: hit@1 71.5 %, hit@5 89.0 %, MRR 0.795; per-kind table in the file) |
| Budgets at 20K synthetic: query p95 ≤ 100 ms with filters; DB ≤ 2× text | **PASS** (12.4 ms; 1.92×) |
| Budget: memory ≤ 150 MB at 20K | **NOT RE-MEASURED in M2** (M0: +61 MB; new 32 MB page cache). Risk §18 |
| If a budget is missed, the plan records the lever | n/a for measured budgets; DB-size accounting change (UTF-8 bytes) recorded in ADR-002 |
| Migrations: upgrade tests from each prior schema version fixture; downgrade protection tested | **PASS** (only v1 exists: upgrade path tested with a v1 fixture → synthetic v2, rollback on failure; `DatabaseTooNewError`) |
| Deletion cascades remove rows from content tables and FTS; saved items survive "delete all except saved" | **PASS** (store tests + integrity check after each delete mode) |
| Tests required: unit, property-based, integration vs the real engine in memory, benchmark thresholds, eval harness in CI | **PASS locally**; CI wiring authored (`verify` runs `test:eval`; `engine-perf` job on main/manual), **not yet run on GitHub** |
| Owner-added: real-browser persistence (SW restart, offscreen recreation, reopen OPFS, still searchable) | **PASS** (Chromium 141 and Chrome 116) |
| Owner-added: Chrome 116 decision | **PASS** (116 supported; ADR-011 updated) |

## 17. Architecture / ADR changes
ADR-002 (M2 implementation record + five refinements), ADR-009 (size budget change), ADR-011 (116 verified for the engine), **ADR-012 new** (model, protocol, search semantics, deletion semantics, maintenance). ADR-006 unchanged: its expiry guard needs the stored last visit per URL, so it is implemented by the M3 history layer with a small `lastVisits` read to be added to the engine then. `engineRequestSchema` changed shape (`{id, call}`); M1's ping-only contract is subsumed (`ping` unchanged).
M0 amendments: A1 ✅ (TypeScript snippets), A2 ✅ (contentless FTS, fold, prefix 3, phrase queries intact), A3 ✅ (bounded OPFS retry, typed failures, interrupted-call recovery, reopen proven in browser), A6 ✅ engine-side (`normalizeUrl`/all writes skip non-http(s)); the importer that feeds it is M3, A7 ✅ (bounded incremental vacuum + cap + retention), A4 deferred to M4/M7, A5 deferred to M3 (policy prototype stays in `spikes/engine/deletion-policy.ts`).

## 18. Remaining risks
1. **Latency tail on prefix-heavy queries**: in-browser p95 ≈ 60 ms at 2K pages (engine time) and Node p95 ≈ 49 ms (distinctive) / 121 ms (stop-word-like) at 20K; M0's harsh class showed ≈ 250 ms at 50K. Levers ready: minimum prefix length before expansion, smaller candidate set, lazy snippets (compute for the first rows only), caching folded titles.
2. **Memory and 20K latency in the real browser were not re-measured** in M2 (Node 20K + browser 2K only). Do a focused browser run in M3/M4 once real data flows.
3. **DB size has no headroom** (1.92× vs 2×) and the synthetic corpus is word-salad; real text, URLs and Greek mixes may differ. Levers: lower per-page cap, `prefix=''` (−0.2×), compress `contents.body`.
4. **Relevance is mechanics-only**: synthetic labels prove folding/prefix/phrase/filters/ranking plumbing; real quality needs the M10 query set. The `prefix` class is inherently ambiguous (hit@5 42 %), Greek single-word hit@1 is 55 % (several pages share a word).
5. **Ingest**: ≈ 85 content pages/s in the browser (per-page transactions) — fine for live Deep Search, too slow for bulk content import (none planned). A long import batch blocks searches (one queue): keep M3 batches ≤ 1,000 rows (≈ 0.4 s).
6. `integrityCheck` ≈ 5 s at 20K pages: scheduled/diagnostic only; never on a user path.
7. SIGKILL-mid-write and long soaks were not repeated on the production engine; the VFS/pragmas are those M0 validated.
8. MiniSearch fallback is not implemented. If OPFS-sahpool ever proves unreliable in the field, a second `SearchStore` implementation is the planned escape (the API is engine-agnostic), but it is unscheduled work.
9. GitHub CI for the new jobs/steps is unverified.
10. Relative months are 30 days and years 365 (documented approximation); `before:` is exclusive.

## 19. Intentionally deferred to M3+
M3: history import/live updates/reconcile (uses `upsertHistory`, batches ≤ 1,000, skips non-http(s)), consent gate, mirrored deletion with the 85-day expiry guard (needs a `lastVisits` engine read), pause/resume, daily alarm calling `maintenance`/`applyRetention`/`enforceCap`, `integrityCheck` scheduling, stats surface. M4: search UI over `engineCall('search')` (rendering `highlights` as text nodes, `approximate` flag, suggestions, filter chips from `filters`). M5: Remember/snippets UI → `savePage`/`addSnippet`, text-fragment builder, export/import UI. M6: capture policy + extractor → `upsertContent`. M7: overlay. M8: full no-network recorder, ledger (needs per-domain stats query), settings.

## 20. Recommended next milestone
**M3 — History pipeline and consent gate.** It is the first consumer of the engine in production and will validate batch sizing, the consent gate and the deletion/expiry wiring. Suggested first steps: add `lastVisits(urls)` to the engine, schedule `maintenance` via `chrome.alarms`, and run a 100K-row import e2e (M0 showed ≈ 40 s) against the real engine.

## 21. Budget-conscious handoff
- Do not re-run M0 benchmarks or re-derive M2 decisions; read ADR-002 (M2 record) and ADR-012.
- Fast loops: `npm test` (≈ 6 s) for engine logic; `npm run build && xvfb-run -a npm run e2e` (≈ 60 s) for integration; `npm run test:perf` (≈ 90 s) only when touching search/ranking/schema; `EVAL_WRITE=1 npm run test:eval` regenerates `docs/eval/baseline.md` and `tests/eval/queries.jsonl` after an intentional ranking change.
- Calling the engine from new code: `engineCall({ method: 'search', params: { query, now: Date.now(), tzOffsetMinutes: -new Date().getTimezoneOffset() } })` from any extension page; from the service worker use `createEngineClient(...).call`.
- When changing the schema: add a numbered migration (never edit v1), add a fixture-upgrade test in `tests/schema-maintenance.test.ts`, bump nothing else.
- Local minimum-version check: Chrome for Testing is downloadable from `storage.googleapis.com/chrome-for-testing-public/116.0.5845.96/linux64/chrome-linux64.zip`; run `CHROMIUM_PATH=… xvfb-run -a npm run e2e`.
