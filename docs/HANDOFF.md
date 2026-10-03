# Handoff (after M0)
Status: M0 complete, G0 = CONDITIONAL PASS. Read docs/spikes/M0-RESULTS.md (results, amendments A1–A7) and docs/adr/. Do not start a milestone without owner approval.
Next: M1 foundation, carrying amendments A1–A7 from the M0 report.
Owner actions (agents cannot do these): Chrome Web Store developer account + unlisted draft upload (record host-permission banner text and privacy checkboxes); 5–10 demand conversations; check Chrome AI history search on a clean Greek-market profile; try Windows/macOS shortcut defaults; decide ADR-007 (encryption) question with store support.
Spike code (`spikes/`) is throwaway: reuse ideas, not files. Reusable pieces: corpus generator, `FtsStore` schema/fold/snippet logic, `deletion-policy.ts`, harness (build/launch/CDP SW stop), overlay host, fixtures.
Gotchas: `history.addUrl` takes only `{url}`; seed old history by writing the History SQLite DB with the browser closed (`spikes/browser/seed-history.py`); `pkill -f` patterns can kill your own shell; Playwright keeps SWs alive (use CDP `ServiceWorker.stopWorker`).
Commands: `npm ci`, `npx tsc --noEmit`, `npx vitest run`, `node spikes/browser/build.mjs`, `xvfb-run -a node spikes/browser/<script>.mjs`, `bash spikes/run-all.sh`.
