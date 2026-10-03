# ADR-011 Minimum Chrome version — Proposed: 116 (UNVERIFIED below 141)
Everything in M0 ran on Chromium 141 only; Chrome docs were unreachable from the sandbox. Blueprint claims: `runtime.getContexts` 116, offscreen 109. Nothing depends on `browser.*` (148) or `offscreen.hasDocument` (150). Spike manifest sets 116.
To accept: run the e2e smoke on a pinned older Chromium in CI (M1) and confirm `use_dynamic_url`, opfs-sahpool sync handles, contentless_delete (SQLite is bundled, so independent of Chrome).
