# M0 results — spikes and decision records

Date: 2026-10-03 · Environment: Chromium 141.0.7390.37 (Playwright build, headed under Xvfb), Linux x64, 4 vCPU, 16 GB RAM, Node 22, `@sqlite.org/sqlite-wasm` 3.53.4 (FTS5 enabled).
Raw outputs: `spikes/results/*.txt`. Reproduce everything: `npm ci && bash spikes/run-all.sh` (~35 min).
Evidence tags: **VERIFIED** (observed in a running Chromium), **MEASURED** (numbers produced by the scripts), **INFERRED** (reasoned or from docs, not observed), **NOT TESTED**.

## 1. Executive summary

The architecture is viable. Every engineering assumption that could be tested in this environment held, with three corrections that must be carried into M1/M2:

1. **SQLite FTS5 + opfs-sahpool in an offscreen-hosted worker works and meets the §5.6 decision rule** — *after two changes*: snippets must be built in TypeScript (FTS5 `snippet()` made p95 ≈ 190 ms at 20K), and the FTS prefix index must be limited to `prefix='3'` (default `'2 3'` produced 2.11× text, over the 2× budget). MiniSearch fails the cold-start and memory criteria at 20K and is kept as fallback only.
2. **The blueprint assumption that `unicode61 remove_diacritics 2` folds Greek accents is false.** Latin diacritics fold; Greek tonos does not. Fix: fold in TypeScript (`NFD`, strip `\p{M}`) before indexing and querying, which implies a *contentless* FTS table (`contentless_delete=1`) with the original text in a separate table.
3. **Chromium's own 90-day history expiry fires `history.onVisitRemoved` with `{allHistory:false, urls:[…]}`**, indistinguishable from a user deleting those URLs. ADR-006's heuristic (ignore removals of URLs whose last visit *we* recorded is >85 days old) is therefore required, not optional.

Also confirmed: locked-down CSP (`connect-src 'none'` etc.) is accepted and *actually stops every outbound request* from page, worker and service worker (control experiment: with the default CSP all 8 probes reached the server); the iframe overlay works on strict-CSP and `frame-src 'none'` pages, is key-isolated from page scripts, and opens focused in ~40 ms — but **a page that steals focus leaks keystrokes unless the host sets `body.inert`** (new requirement).

Not done (cannot be done by an agent in this environment): Chrome Web Store draft upload and privacy-field inspection, Windows/macOS shortcut checks, the demand conversations, a *real* 24 h soak, the 15-page real-site manual overlay matrix, a Chrome-version matrix. They are listed under remaining risks; none blocks M1.

**G0: CONDITIONAL PASS.** Engine criteria pass, overlay is viable (so the popup-only fallback is not needed), a history-only release (R1) remains available if the store review path is bad. The conditional part is the three human-only items.

## 2. Spikes

### S1. Permission and Web Store review spike — NOT TESTED (partially covered)
- Tests: does the optional-host-permission design avoid the in-depth-review banner; what the privacy fields look like.
- Method: requires a Chrome Web Store developer account, a one-time fee, and a dashboard upload. Not possible for an agent. Official docs (`developer.chrome.com`) were also unreachable (egress blocked), so no documentation re-check was possible.
- What *was* verified: a manifest with `history, storage, unlimitedStorage, contextMenus, activeTab, scripting, offscreen, alarms` + `optional_host_permissions: [https://*/*, http://*/*]` + locked CSP loads in Chromium 141 with **zero manifest errors and zero install warnings** (`chrome.developerPrivate.getExtensionsInfo`, `spikes/results/csp-shortcuts.txt` part 1). Note: this is Chromium; the Web Store's own warning text for `history` is unchanged from the blueprint [INFERRED].
- **Action for the owner:** do the draft upload (unlisted, unpublished) before M9, record banner text in this doc.

### S2. Engine benchmark — FTS5/opfs-sahpool vs MiniSearch — MEASURED
- Tests: ARCHITECTURE §5.6 decision rule.
- Method: synthetic corpora (`spikes/shared/corpus.ts`: deterministic, Zipf vocabulary 30K, ~5.4 KB mean page, 50 KB cap) of 5K/20K/50K pages. Real extension (`spikes/browser/dist/base`) in headed Chromium: SW → offscreen document (reason `WORKERS`) → module Worker → sqlite-wasm with **opfs-sahpool**. Schema `pages / contents / fts_main (contentless_delete) / fts_meta (trigram)`; inserts in 100-page transactions. Query sets: *distinctive* (1–3 words outside the 300 most frequent, last word half the time a ≥3-char prefix), *frequency* (adversarial, sampled by occurrence → stop-word-like), and *DB-sampled* (harsh: a ≥5-char word + 4-char prefix of another word). Top-200 retrieval by `bm25(title 10, body 1)` + snippets for the top 50. RSS = sum of RSS of Chromium `--extension-process` renderers (includes SW + a bench page + offscreen, baseline 143–146 MB). Scripts: `bench-engine.mjs`, `bench-memory.mjs`, `engine/node-bench.ts`.

Results (browser, final schema; ms):

| pages | text MB | DB MB (×text) | insert pages/s | query p50/p95 distinctive | filtered (domain+date) p95 | adversarial p95 | cold open (median) | warm reopen | cold open + 1st query (2-char prefix "ba") |
|---|---|---|---|---|---|---|---|---|---|
| 5K | 26.2 | 54.0 (2.06) | 1,610 | 2.2 / 6.9 | 3.4 | 26 | 115 | 0.6 | 219 |
| 20K | 107.2 | 211.6 (1.97) | 1,268 | 3.5 / 14.9 | 7.8 | 96 | 114 | 0.5 | 316 |
| 50K | 271.3 | 532.5 (1.96) | 1,015 | 5.0 / 35.2 | 23.1 | 226 | 114 | 0.7 | 556 |

- DB-sampled harsh queries at 20K, cold-restarted engine: p50 24 ms / p95 **87 ms**; at 50K p95 240 ms (50K is outside the budget).
- Memory at 20K: steady-state RSS after a cold restart + 300 queries = **207 MB vs 146 MB baseline (+61 MB)**; wasm heap 30 MB. (First measurement, +262 MB, was polluted by the benchmark holding the generated corpus; fixed by `benchFromDb`.) 50K: +98 MB (RSS 243 MB).
- First query after cold open with a distinctive-ish query: 101–119 ms (20K), 178–232 ms (50K).
- DB integrity (`PRAGMA integrity_check` + FTS5 `integrity-check`) OK after every load.
- MiniSearch (same worker): build 3.6 s / 15.6 s / 43 s; RSS +151 / +400 / +981 MB; distinctive p95 5 / 23 / 58 ms; adversarial p95 95 / 554 / 2,088 ms; **cold start = JSON.parse+loadJSON 326 ms / 1,456 ms / 4,742 ms** (+ 0.75 / 2.4 / 8.7 s to serialise a snapshot of 16 / 67 / 174 MB).
- Package: `dist/base` is 1.47 MB unzipped, **543 KB zipped** (sqlite3.wasm 869 KB, worker bundle incl. MiniSearch 587 KB).
- Two design changes found by measurement (`spikes/engine/profile.ts`, `size-levers.ts`):
  - Candidate retrieval is cheap (p95 ≈ 14 ms @20K) but FTS5 `snippet()` re-evaluates the match: p95 **198 ms** even when restricted with `rowid = ?` (190 ms). TypeScript snippets from stored text for the top 50: total p95 **15.6 ms**.
  - Prefix indexes (20K): `'2 3'` 2.11× (p95 adv. 106), `'3'` **1.97×** (122), `'2'` 1.88× (146), none 1.74× (236). Chosen `'3'`. Page size 16 KB changes nothing.
- Decision-rule verdict (20K): p95 ≤100 ms with filters **PASS** (7.8 ms; adversarial unfiltered 96 ms is marginal); cold open ≤300 ms **PASS** (114 ms); warm ≤20 ms **PASS** (0.5 ms); DB ≤2× text **PASS, thin** (1.97×); worker memory ≤150 MB **PASS** (+61 MB); 24 h simulated indexing without corruption **PASS for the compressed soak (S3)**, real 24 h NOT TESTED. **Chosen engine: SQLite FTS5.**
- Caveat: synthetic word-salad text. Real text has more distinct tokens, numbers, URLs; size ratio and tail latency must be re-checked in M2 on real-ish text.

### S3. Lifecycle resilience and soak — VERIFIED / MEASURED
- Tests: stateless-SW architecture, offscreen lifecycle, single-owner DB, crash safety.
- Method (`resilience.mjs`, `soak.mjs`): CDP `ServiceWorker.stopWorker`; closing the offscreen document mid-insert; a second Worker opening the same sahpool DB; `SIGKILL` of the whole browser mid-write and relaunch of the same profile; then a **15-minute compressed soak**: continuous churn (10 inserts + 10 deletes per 250 ms cycle + queries) on a 5K-page DB, offscreen document closed mid-write every ~20 s, SW stopped every ~45 s, consistency checks every 3 min.
- Results:
  - SW stopped → a named Port from an extension page to the offscreen document kept answering queries (**VERIFIED**: Port to the offscreen doc does not depend on the SW); SW restarted on the next message; offscreen document survived.
  - Offscreen closed mid-insert → **the new worker cannot open the DB immediately**: `createSyncAccessHandle … another open Access Handle` for ≈2 s (19 retries at 100 ms). Fixed by a retry-with-backoff in `open` (**required in M2**). After that: 5,070 pages, `pages = contents = fts_meta`, both integrity checks OK. In-flight call fails with "message channel closed" (callers must retry).
  - Second concurrent owner → blocks (no result within 8 s) and never corrupts: the exclusive-owner rule holds.
  - `SIGKILL` mid-write → relaunch opens on the first attempt, 5,930 pages, consistent, integrity OK; whole relaunch-to-open 1.5 s.
  - Soak: **20,450 inserts + 20,450 deletes, 6,135 queries, 44 offscreen closes mid-write, 20 SW stops, 0 errors, 5 consistency checks 0 failures**; reopen after close median 857 ms (max 1.4 s, dominated by the handle-release wait), first query after reopen median 24 ms; extension RSS flat (224–247 MB). DB file grew 52.8 → 82.9 MB under churn with no vacuum → M2 must run `incremental_vacuum`/`auto_vacuum`.
- **NOT TESTED:** a real 24 h run; Playwright keeps a DevTools session attached to the SW, which also prevents *natural* 30 s idle termination (a 60 s wait did not stop it), so natural idle termination was not observed — forced stop was.

### S4. Deletion semantics and expiry — VERIFIED
- Tests: what `history.onVisitRemoved` reports (ADR-006).
- Method: `deletion.mjs` (user-style APIs) and `expiry.mjs`. `history.addUrl` in Chromium 141 accepts **only `{url}`** (no `visitTime`/`title`), so expiry was provoked by writing 70 URLs dated 100 days ago directly into the closed profile's `History` SQLite DB, relaunching, and watching events + `history.search`.
- Results:

| action | event | state after |
|---|---|---|
| `history.deleteUrl(u)` | `{allHistory:false, urls:[u]}` | row gone |
| `history.deleteRange` covering a URL's only visit | `{allHistory:false, urls:[u]}` | row gone |
| `history.deleteRange` covering only the newest of 2 visits | `{allHistory:false, urls:[]}` | **URL stays**, visitCount 1 |
| `browsingData.removeHistory({since:0})` ("Clear browsing data") | `{allHistory:true, urls:[]}` | all gone |
| `history.deleteAll()` | `{allHistory:true, urls:[]}` | all gone |
| **Chromium automatic expiry (>90 days)** | **`{allHistory:false, urls:[…32 per event…]}`** — 3 events for 70 URLs, first ~40 s after browser start, last ~120 s | rows gone |

- Conclusion: expiry is indistinguishable from a user deleting those URLs; the heuristic in `spikes/engine/deletion-policy.ts` (tested) is required. Also: Chrome history contains `chrome-extension://…` pages — the importer must skip non-http(s).
- Not tested: the real Chrome "Clear browsing data" dialog UI and the History-page "Remove selected items" (assumed to use the same backend calls) [INFERRED]; synced (remote) deletions.

### S5. CSP lockdown — VERIFIED
- Tests: does Chrome accept the locked-down `extension_pages` CSP; does it actually block exfiltration.
- Method: `csp-shortcuts.mjs`. CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'`. A local HTTP server records every request. From an extension page, the offscreen worker and the SW, fire `fetch(no-cors)`, `sendBeacon`, `Image`, `WebSocket`, XHR, `<link rel=prefetch>`; compare the locked manifest with one using Chrome's default CSP.
- Results: accepted, zero errors/warnings, SQLite WASM runs under it. **Locked CSP: server received 0 requests** from any context (worker and SW fetch rejected with "Failed to fetch"). **Default CSP: all 8 probes arrived.** This confirms the blueprint's honesty note: lacking `host_permissions` does not stop requests; the CSP does.
- Note `frame-src 'none'` in `extension_pages` does not affect the overlay (the iframe is created by the content script in the *page*). An intentionally invalid MV3 CSP (`script-src https://…`) made Chromium's `--load-extension` launch fail/hang; not analysed further.

### S6. Overlay — VERIFIED on fixtures; manual real-site matrix NOT TESTED
- Tests: ADR-003.
- Method: `overlay.mjs`, `dynamic-url.mjs`. Injection with `scripting.executeScript` of a content script that creates a `popover="manual"` host (top layer) with a **closed** shadow root containing one `<iframe src=search.html>`; typing with real CDP keystrokes *without clicking the overlay*; a hostile page script records key/input events in the capture phase; screenshot pixel checks for painting. Test builds use a `127.0.0.1` host permission because Playwright cannot click the toolbar or grant `activeTab`.
- Results (all focused at open, typed text intact, closed with Esc, focus returned to the page input):

| scenario | opens | focused after | page script saw keys |
|---|---|---|---|
| plain | yes | ~40–60 ms | 0 |
| page CSP `default-src 'none'; frame-src 'self'` | yes | ~40 ms | 0 |
| page CSP `frame-src 'none'; child-src 'none'` | **yes** (extension frames exempt) | ~47 ms | 0 |
| page containing an iframe | yes | ~40 ms | 0 |
| fullscreen element already active | **yes, painted above it** (top layer) | ~40 ms | 0 |
| **page refocuses its own input every 50 ms** | yes | — | **24 events: the query leaked to the page; typing into the overlay failed** |
| same + `document.body.inert = true` while open | yes | ~46 ms | **0, typing works** |

  Open-to-focused latency, 10 runs (driver round-trip incl. executeScript + iframe load + focus): median **40 ms**, max 49 ms (budget 150 ms).
- Bugs found and fixed in the spike: `iframe.focus()` leaves the inner `activeElement` empty → `search.ts` must hand focus to the input on `window` `focus`. Without it the user's first keystrokes go nowhere.
- Restricted pages: `chrome://version`, `chrome://newtab` → `executeScript` throws "Cannot access a chrome:// URL"; `about:blank` → "Cannot access contents of the page…"; in all three the popup-window fallback opened. Web Store pages and PDF viewer: NOT TESTED (no network / not in fixtures) [INFERRED same failure path].
- Only the host element and its `inert` toggle are visible to the page (`querySelector('iframe')` finds nothing; `document.activeElement` is the host `DIV`). The page can see that *an* overlay exists.
- `use_dynamic_url: true`: overlay still works in every scenario; a page `fetch(chrome-extension://<id>/search.js)` is **blocked** (vs 200 without it), so fetch-based fingerprinting is stopped. An iframe probe fired `load` in both cases (error pages also fire `load`), so that vector is inconclusive. Playwright reports the same host for the overlay frame; not investigated further.
- NOT TESTED: the 15 real-site matrix (GitHub, Google Docs, YouTube, PDF, bank-like, `file://`…), real fullscreen video, IME; `activeTab`-based injection (gesture-granted) instead of host permission [INFERRED to behave the same; the API call is identical].

### S7. Shortcuts — PARTIAL
- Method: two copies of the extension with identical `suggested_key` loaded together; `chrome.commands.getAll()` in each.
- Result (VERIFIED, Linux): the first keeps `Ctrl+Shift+Y`; the second reports `shortcut: ""` — **silently unassigned and detectable** via `commands.getAll()`. `_execute_action` has no shortcut by default.
- NOT TESTED: Windows/macOS conflicts, conflicts with real third-party extensions and Chrome built-ins (Playwright cannot press browser shortcuts). Proposal below is INFERRED.
- Proposal: `open-search`: `Ctrl+Shift+Y` / `Command+Shift+Y`; `remember-page`: unassigned by default (documented, user can bind) or `Ctrl+Shift+U` / `Command+Shift+U`. Avoid `Alt+Shift+*` on Windows (keyboard-layout switching is common for Greek users) and `Ctrl+K`/`Ctrl+Shift+A` (Chrome's own). Verify on Windows/macOS in M4 before fixing.

### S8. History import at scale — MEASURED
- Method (`history-scale.mjs`): 100,000 URLs spread over 89 days written into the closed profile's History DB; then the extension API.
- Results: default `maxResults` is **100** (confirmed; 947 ms to return them); omitted `startTime` = last 24 h (1,131 rows); `startTime:0, maxResults:1e6` → all **100,001 rows in 2.0 s (17 MB JSON)**; 14 seven-day windows with `maxResults:1e6` → 2.1 s total, largest window 8,024 rows; a bounded `maxResults:1000` importer that subdivides full windows needed 260 calls / 18.5 s. End-to-end import into the engine (title-only, FTS5 + trigram) via SW→offscreen messaging in batches of 1,000: read 6.5 s + insert 33 s ≈ **3,000 rows/s, ~40 s for 100K**, DB 70 MB. Title-only queries on the 100K DB: 9–34 ms.
- Recommendation: 7-day windows, `maxResults` large (e.g. 50,000) with subdivision if a window returns exactly that many; batches of 1,000 to the engine; skip non-http(s) URLs. Chrome returns one row per URL (last visit), so visit history granularity is not available.

### S9. Greek/accent tokenisation — MEASURED
- Method: `spikes/engine/engine.test.ts` (Vitest, in-memory sqlite-wasm).
- Results: **FAIL (assumption)**: raw `unicode61 remove_diacritics 2` does not fold Greek tonos (`λόγος` ≠ `λογος`); it does fold Latin diacritics (`café`=`cafe`), case and final sigma (`ΛΟΓΟΣ`=`λογοσ`=`λογος`). **Fix verified:** `fold()` = NFD + strip `\p{M}` + lowercase in TypeScript on both sides: `βιβλίο`=`βιβλιο`=`ΒΙΒΛΊΟ`, `λόγος`=`ΛΟΓΟΣ`, `zürich`=`zurich`, trigram titles/URLs accent-insensitive. Prefix (≥3 chars) reaches inflections (`βιβλ` finds βιβλίο and βιβλία); **known limit, tested:** no stemming — full-word `βιβλίο` does not find `βιβλία`. 2-char prefixes work (term scan).
- Consequence: FTS table must be contentless (`content='', contentless_delete=1`, SQLite ≥3.43) holding folded tokens, with original text in `contents` (stored once). Cost: DB 2.06× → 1.97× after the `prefix='3'` change.

### S10. Minimum Chrome version and test matrix — PARTIAL
- Everything above ran on **Chromium 141 only**. Official docs were unreachable (egress blocked) so API-introduction versions are the blueprint's `[V]` claims: `runtime.getContexts` 116, offscreen 109. `use_dynamic_url`'s first version was not verified.
- Recommendation (INFERRED): `minimum_chrome_version: "116"` as in the spike manifest, raise it if CI on older builds fails; **ADR-011 stays Proposed** until CI can run a pinned older Chromium (not downloadable here). No code depends on `browser.*` (148) or `offscreen.hasDocument` (150).

### S11. Light demand check — NOT TESTED
Human conversations and checking Chrome's AI history search on a clean Greek profile cannot be done by an agent.

## 3. Acceptance criteria

| # | Criterion (IMPLEMENTATION_PLAN M0) | Result |
|---|---|---|
| 1 | Each of the ten items has a written result with data or screenshots | **PARTIAL FAIL** — 7 of 10 have data (engine, deletion/expiry, CSP, overlay, history scale, Greek, shortcuts-on-Linux); S1 (store upload), S11 (demand) NOT TESTED, S10 only Chromium 141. No screenshots were saved (pixel assertions instead). |
| 2 | Engine decision rule evaluated explicitly; chosen engine recorded | **PASS** — FTS5; see S2 and ADR-002 |
| 3 | ADR-006 states exact deletion and expiry behaviour | **PASS** — measured, ADR-006 + tested prototype |
| 4 | Draft store upload outcome recorded incl. host-permission banner | **FAIL / NOT TESTED** — human action |
| 5 | Default shortcut proposal and fallback behaviour recorded | **PASS (provisional)** — proposal + detection verified on Linux only |
| 6 | Benchmark scripts reproducible from the repo | **PASS** — `spikes/run-all.sh` |
| 7 | Soak test log attached | **PASS with caveat** — `spikes/results/soak.txt`, 15-min compressed soak, not 24 h |

## 4. G0 gate: CONDITIONAL PASS
Stop conditions from the plan: engine fails and fallback unacceptable — **no** (engine passes); store review path unworkable with no history-only fallback — **unknown but R1 (history-only) remains available**; overlay unworkable — **no** (works; popup fallback verified). Therefore proceed to M1, with the owner completing S1/S11 in parallel (neither blocks M1–M8).

## 5. Architecture decisions
Confirmed: D1 MV3/TS/Chrome-only; D2/D3/D4 permission model (manifest loads clean) — review impact unverified; **D5 FTS5 + opfs-sahpool in offscreen worker (with changes below)**; D6 iframe overlay + popup fallback (with `inert`); D7 SW-driven injection; D8 locked CSP does enforce no-network; single-owner DB; Port UI→engine.
Changed/added:
- A1 **Snippets in TypeScript**, not FTS5 `snippet()`.
- A2 **FTS `prefix='3'`**, contentless FTS (`contentless_delete=1`) with TypeScript `fold()` (Greek).
- A3 **Offscreen open must retry** (~2 s worst case after abrupt close); callers retry in-flight messages.
- A4 **Overlay host sets `body.inert` while open** and the search page hands focus to its input on window focus; the host uses `popover="manual"` for top-layer stacking (fullscreen works).
- A5 **Expiry guard** in deletion mirroring (ADR-006).
- A6 Importer skips non-http(s) URLs (extension pages appear in history).
- A7 Run `incremental_vacuum` (DB grows under churn).
Rejected: MiniSearch as primary engine (cold start 1.5 s @20K, +400 MB RSS, 15 s rebuild); FTS5 `detail=none`/`detail=column` (blocks phrase queries, which the spec requires); default `prefix='2 3'`.

## 6. Remaining technical risks
1. **Web Store review of `history` + optional hosts, and the at-rest encryption FAQ question** — untested (needs account).
2. DB/text ratio 1.97× leaves no headroom; real text may exceed 2×. Levers: `prefix=''`(1.74×), lower per-page cap, compression of `contents.body`.
3. Adversarial/prefix-heavy queries at 20K are at 87–96 ms p95 (budget 100); unmeasured on real queries. Levers: min prefix length before expansion, candidate cap, exact-first then prefix.
4. 50K pages: p95 up to ~250 ms on harsh queries; first query after cold open 173–556 ms depending on query; plan a "warm on shortcut press" prefetch.
5. Real 24 h soak and natural SW idle termination not observed; Chrome versions other than 141 untested.
6. Overlay on the real-site matrix, IME, `activeTab`-only injection, Web Store/PDF pages, Windows/macOS shortcut conflicts untested. The focus-steal leak shows hostile pages can attack keystroke isolation; `inert` fixed the one tested vector — more adversarial fixtures (e.g. pages using `focusin` handlers, `contenteditable` traps, shadow-DOM focus) needed in M7.
7. Synthetic corpus: word-salad text; ranking quality is not evaluated at all (no relevance set yet).
8. Greek: no stemming (documented limit).

## 7. Files
Created: `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `spikes/shared/corpus.ts`, `spikes/engine/{fts-store,node-bench,profile,size-levers,deletion-policy}.ts`, `spikes/engine/engine.test.ts`, `spikes/browser/{build,harness,bench-engine,bench-memory,resilience,soak,history-scale,deletion,expiry,overlay,dynamic-url,csp-shortcuts,fixtures-server}.mjs`, `spikes/browser/seed-history.py`, `spikes/browser/src/*.ts`, `spikes/browser/fixtures/*.html`, `spikes/run-all.sh`, `spikes/results/*.txt`, `docs/spikes/M0-RESULTS.md`, `docs/adr/ADR-001/002/003/006/011`, `docs/HANDOFF.md`. Modified: `README.md`. Untouched: `BROWSER_RECALL_MASTER_BLUEPRINT.md`.

## 8. Commands run and results
- `npx tsc --noEmit` → clean. `npx vitest run` → **25/25 pass** (sqlite build, corpus, FtsStore, hostile queries, Greek/accent behaviour, ADR-006 policy).
- `bash spikes/run-all.sh` pieces: node-bench, size-levers, snippet profile, bench-engine (5K/20K/50K), bench-memory, resilience, soak (15 min), history-scale (100K), deletion, expiry, overlay (test + dyn), dynamic-url, csp-shortcuts — all completed; outputs in `spikes/results/`. Individual runs were repeated while debugging (e.g. overlay harness `frame.press` flake replaced by `page.keyboard.press`).
- Lint: no ESLint rules exist yet (the network/innerHTML bans are an M1 deliverable); the script was removed rather than left failing.

## 9. Recommended next milestone
**M1 (project foundation)**, carrying A1–A7. Owner actions in parallel: Web Store draft upload (S1), a few demand conversations (S11). Suggested M1 additions: pin a second, older Chromium in CI for ADR-011; add adversarial overlay fixtures.

## 10. Blueprint amendments (evidence-based)
1. ARCHITECTURE §5.1/§5.4: replace "unicode61 with diacritic removal folds Greek tonos" with TypeScript folding + contentless FTS; `prefix` = `'3'` not `'2 3'`.
2. §5.2/§5.5: snippets via TypeScript; FTS5 `snippet()` is not usable at the latency budget.
3. §4.6 / ADR-006: expiry fires `onVisitRemoved` with a URL list; expiry guard mandatory; partial-visit deletion fires with an empty list.
4. §9 reliability: offscreen reopen retry; sahpool handles released with ≈2 s delay.
5. §8/§2.1 overlay: `body.inert` while open; `popover=manual`; search page focus hand-off; page CSP `frame-src` does not block extension frames.
6. §3 manifest: `use_dynamic_url` works and blocks fetch probing; keep, but verify store acceptance.
7. §4.1 importer: skip non-http(s); `history.addUrl` takes only `url` (affects e2e seeding: seed by writing the History DB or by visiting fixture pages).
8. §5.6 add "adversarial/prefix-heavy" query class to the benchmark rule; budget table: package ≈ 0.55 MB zipped, not "≤5 MB" concern.
9. §10: Playwright's attached DevTools session prevents natural SW idle termination; use `ServiceWorker.stopWorker` in e2e.
