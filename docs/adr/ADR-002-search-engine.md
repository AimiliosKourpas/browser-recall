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
