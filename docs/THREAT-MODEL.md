# Threat model (V1)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Browsing data leaves the device | No network permission use; extension-page CSP `connect-src 'none'`, `default-src 'none'`; ESLint bans fetch/XHR/WebSocket/sendBeacon/eval/innerHTML/remote import; built-output scan for URLs and eval; e2e request recorders | A future code change that bypasses all of these (guarded by CI) |
| Remote code / supply chain | MV3 forbids remote code; local sqlite-wasm; `npm audit --omit=dev` in CI; CodeQL; lockfile; minimal runtime dependencies (preact, zod, sqlite-wasm) | Build-time tooling advisories (dev only, nothing ships) |
| Malicious web page reads the index or controls the extension | No content scripts; no `externally_connectable`; messages validated with zod and the sender checked (own extension pages only; the service worker answers nothing else); overlay is a closed shadow root + iframe with a dynamic URL; the page never gets a message channel | A page can detect that an overlay exists |
| Page keystroke/CSS interference with the overlay | `body.inert` while open, exact restore; inline `!important` host styles; popover top layer; window fallback on any failure | Real-site matrix is an owner manual test |
| Over-collection (private pages, credentials) | Deep Search opt-in; skips password/payment fields, incognito, local/intranet hosts, excluded sites; caps on text size; consent versioned | Sensitive text on ordinary pages is indexed if Deep Search is on; exclusions and delete tools exist |
| Local attacker with profile/OS access | None beyond OS protections: the index is not encrypted (documented, no encryption claim) | Anyone with the profile can read the index |
| Data outliving user intent | Mirrored deletion (default on) with Chrome-expiry guard, retention, storage cap, delete page/site/range/all, export before uninstall, Chrome removes data on uninstall | Exports are plain files |
| Malicious import file | Strict zod schema, size limit, data only (never evaluated), engine upserts with parameterised SQL | None known |
| SQL injection / XSS | Parameterised statements only; search text and snippets rendered as text nodes (`<mark>` built from ranges); no `innerHTML` | — |
