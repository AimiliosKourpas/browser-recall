# ADR-003 UI surface — Accepted: iframe overlay with popup-window fallback (with required mitigations)
Evidence: docs/spikes/M0-RESULTS.md S6 (fixtures only; the real-site matrix is for M7).
Works: plain, strict page CSP, `frame-src 'none'` page CSP (extension frames are exempt), framed pages, fullscreen (host uses `popover="manual"` → top layer). Focused ~40 ms after the command; keystrokes invisible to page scripts. `chrome://` and `about:blank` fall back to a popup window.
Required: (1) the search page must move focus to its input on window `focus` (iframe.focus() alone leaves nothing focused); (2) the host must set `document.body.inert = true` while open — a page that refocuses its own input every 50 ms otherwise swallows typing AND receives every keystroke (24 events leaked in the test); restore on close; (3) closed shadow root + single iframe; (4) `use_dynamic_url: true` works and blocks `fetch` probing of the static extension URL.
Decision gate for M7 unchanged: if the 15-site matrix is poor, ship popup-only.

M1 note: the manifest declares NO `web_accessible_resources` yet (tests enforce this). M7 adds the search page as a WAR with `use_dynamic_url: true` through this ADR; in M1 the search page opens only as a popup window (toolbar click / shortcut).
