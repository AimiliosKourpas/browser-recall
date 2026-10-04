# ADR-006 Deletion mirroring and expiry — Accepted
Measured in Chromium 141 (docs/spikes/M0-RESULTS.md S4):
- `deleteUrl` / `deleteRange` removing whole URLs → `{allHistory:false, urls:[…]}`.
- `deleteRange` removing only some visits of a URL → `{allHistory:false, urls:[]}` and the URL stays (no action; reconcile fixes counts).
- Clear browsing data (`browsingData.removeHistory`) and `deleteAll` → `{allHistory:true}`.
- **Chromium's automatic >90-day expiry → `{allHistory:false, urls:[…≤32 per event…]}`, indistinguishable from a user deletion.**
Decision (prototype + tests: spikes/engine/deletion-policy.ts):
- `allHistory:true` → delete everything except Saved.
- URL list → for each URL we know, if our recorded `last_visit` is older than **85 days** treat it as Chrome expiry and ignore; otherwise delete its History/Deep data (never Saved).
- Setting "mirror deletions" (default on) and an "also mirror old removals" override.
- Empty list → no-op. Unknown URL → no-op.
Residual risk: a user deliberately deleting a >85-day-old entry (only possible for synced/archived entries) is not mirrored. Not tested: History-page UI and remote (sync) deletions.

## M3 implementation record (docs/milestones/M3-RESULTS.md)
Implemented in `src/background/pipeline/deletion.ts` + `controller.ts` (`onVisitRemoved`), using the engine's new read-only `lastVisits(urls)`: `allHistory` → `deleteAllExceptSaved`; URL list → each URL whose STORED last visit is within 85 days is deleted (`deleteUrls`; saved pages only lose their history flag), older ones are ignored as Chrome expiry; unknown URLs and empty lists (partial-visit deletions) are no-ops. Guard value 85 days; "mirror deletions" and "guard" switches exist in `planRemoval` but are fixed on until the M8 settings UI.
End-to-end proof (real Chromium 141 and Chrome 116): 70 rows 100 days old are imported, Chrome's own expiry job then removes them from `chrome.history`, and all 70 stay searchable. **Mutation check**: with the guard disabled the same test fails (0 of 70 remain), i.e. the test exercises the real expiry events and the guard is what preserves the archive.
