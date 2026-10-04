# Browser Recall
**Find anything you've seen before.** A privacy-first Chrome extension (Manifest V3) that turns your browsing history into a fast, local, searchable memory. No account, no backend, no telemetry, no paid AI — your browsing data never leaves the device.

Status: **M3 (history pipeline + consent) complete** — a consenting user's history is imported and kept in sync locally; the search UI (M4) comes next. See `docs/HANDOFF.md`.

## Develop
```
npm ci
npm run check            # typecheck, lint, unit tests, relevance eval, build, built-manifest tests, size limit
npm run test:perf        # engine performance guards at 20K pages (slow)
xvfb-run -a npm run e2e  # Playwright on a headed Chromium with the built extension (CHROMIUM_PATH selects another build)
npm run build            # → .output/chrome-mv3 (load unpacked at chrome://extensions)
```
## Where things are
`BROWSER_RECALL_MASTER_BLUEPRINT.md` product + architecture + plan · `docs/spikes/M0-RESULTS.md` measured evidence · `docs/milestones/` milestone reports · `docs/adr/` decisions · `src/` production code · `spikes/` throwaway M0 code · `CONTRIBUTING.md` · `SECURITY.md` · MIT licensed.
