# ADR-002 Search engine — Accepted: SQLite FTS5 (opfs-sahpool, offscreen worker); MiniSearch fallback only
Evidence: docs/spikes/M0-RESULTS.md S2, S3, S9. At 20K synthetic pages in Chromium 141: DB 1.97× text, filtered p95 7.8 ms (adversarial 96 ms), cold open 114 ms, warm 0.5 ms, +61 MB RSS; compressed soak with 44 mid-write offscreen closes and 20 SW stops had 0 errors/corruption; SIGKILL recovery clean. MiniSearch: 1.5 s cold load, +400 MB, 15 s build at 20K.
Mandatory implementation details (found by measurement):
1. Snippets built in TypeScript from stored text (FTS5 `snippet()` p95 ≈ 190 ms @20K).
2. `prefix='3'` (default `'2 3'` = 2.11× text, over budget). Never `detail=none|column` (no phrase queries).
3. Contentless FTS (`content='', contentless_delete=1`) fed with TypeScript-folded text (NFD, strip `\p{M}`, lowercase) — `unicode61 remove_diacritics 2` does NOT fold Greek tonos. Original text lives in `contents`.
4. `open()` retries (100 ms backoff, ~2 s worst case) because the previous worker releases OPFS sync handles late; in-flight messages fail on offscreen close and must be retried by the caller.
5. Run `incremental_vacuum` (file grew 53→83 MB under churn).
6. Single owner: a second worker blocks; never corrupts.
Risks: DB ratio 1.97× has no headroom; adversarial prefix queries ≈ 90–96 ms p95 at 20K; real text unmeasured. Re-evaluate in M2 with real-ish text and a relevance set.

## M2 implementation record (2026-10-03, docs/milestones/M2-RESULTS.md)
Implemented as decided: `src/engine/{schema,store,sqlite}.ts` — contentless FTS5 (`content='', contentless_delete=1`, `prefix='3'`, no `detail=`), original text in `contents` once, `fold()` (NFD → strip `\p{M}` → lowercase, plus ς→σ) applied to every indexed field and every query token, TypeScript snippets, `auto_vacuum=INCREMENTAL` set before the first table, OPFS-sahpool open with bounded retry (60 attempts, 100→250 ms), single owner (the engine worker, calls serialised through one queue).
Findings that refine the M0 notes:
1. **Size accounting must use UTF-8 bytes**: with 20% Greek text, `String.length` made the DB look 2.26× the text; in bytes it is 1.92× (20K pages, Node). `stats().textBytes` is UTF-8 bytes.
2. **`PRAGMA incremental_vacuum(N)` must be stepped to completion** (`db.exec` frees one page): M0 never exercised vacuum. Implemented with a prepared statement loop; tested (churn → free list → bounded reclaim → file shrinks).
3. **Final sigma**: JS lower-casing chooses ς by context, so per-character folding (needed for snippet offsets) disagreed with whole-string folding; `fold()` maps ς→σ (context-free). SQLite's tokenizer folds the two sigmas too.
4. Search is implemented as SQL candidate retrieval (bm25 top 200, weights title 10 / headings 4 / description 3 / body 1) + TypeScript re-rank. The SQL is ~0.5 ms p50; the TypeScript re-rank/snippet stage dominates latency (see M2 report) — M0's "snippets in TypeScript" assumption holds, but the re-rank/snippet work is not free (p95 ≈ 49 ms vs M0's 15 ms on the same query class at 20K, still inside the 100 ms budget).
5. bm25 normalisation is relative to the best candidate (not min-max): min-max blew tiny differences up to the full range and drowned the saved/recency boosts.
