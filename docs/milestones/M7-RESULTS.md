# M7 results — Overlay + product integration

Branch `claude/m7-overlay-integration` (from main after M6). Verified locally: Chromium 141 (full e2e) and Chrome for Testing 116 (overlay, search-ui, foundation, deep-search specs). GitHub CI not yet run on this branch.

## Implemented
- **Overlay** (`src/overlay/`, `src/entrypoints/overlay-host.ts`, ADR-003 record): popover host + closed shadow root + backdrop + one iframe of the existing Search UI (`?overlay=1`). `body` inert while open, exact restore (absent attribute, or its original value) on close, failure and `pagehide`; focus returns to the previously focused element. Click-outside and Esc close; Enter opens a result (foreground tab) and closes. Second invocation closes (toggle).
- **Open path** (`src/background/open-search.ts`): toolbar click and `open-search` command → overlay when injectable, otherwise the popup window; chrome://, extension pages and about: skip the attempt; injection error, silent host or an unrendered host all fall back to the window. `sw/open-search {tabId?}` (trusted pages) runs the same path; `sw/overlay-close` relays the close from the iframe using `sender.tab`.
- **Search UI reuse**: same app; only `closeSurface()` (overlay vs window close) and window-focus→input differ.
- **Manifest**: `web_accessible_resources` for `search.html` only (http/https matches, `use_dynamic_url`), pinned by tests. Still no content scripts, no host permissions.
- Overlay injection works through activeTab (command/toolbar) in production; the e2e build uses its fixture host permission because Playwright cannot press the shortcut.

## Tests
Unit **317/317** (new `tests/overlay.test.ts`: inert snapshot/restore, protocol guards, every open/fallback branch; manifest/messages updates). e2e **26/26** Chromium 141 (new `e2e/overlay.spec.ts`): focus without click; keystrokes never reach the page (capture-phase logger sees 0 events, field value unchanged; mutation-tested: removing `inert` fails the spec); real engine results; ArrowDown+Enter opens a foreground tab and closes the overlay; reopen, empty state, Esc restores focus and inert; 4× repeated toggle leaves nothing behind; click-outside; hostile fixture (page CSS hiding div/iframe/[popover] with `!important`, max z-index cover, focus stolen every 50 ms), strict page CSP (`frame-src 'none'`), fixed/top-z layout, pre-existing `inert` body restored exactly; Saved, Snippet and Deep results, operators and empty state inside the overlay; chrome://version and about:blank → popup window; production build without access → window. Chrome 116: overlay, search-ui, foundation, deep-search specs pass (15/15). typecheck/lint clean; built 5/5; eval 1/1; `npm audit --omit=dev` 0.
Size: JS 156.25 kB gz (limit 160, +1.9 kB incl. 3.3 kB-raw host script); all files 565.2 kB (limit 620). **Headroom is now 3.75 kB**; M8 must justify a budget change.

## Not verified / owner manual
Real-site matrix (`docs/qa/overlay-matrix.md`); real shortcut/toolbar activeTab grant (the e2e build substitutes a host permission); IME inside the overlay; real fullscreen video. Playwright does not expose popup windows as pages, so the fallback is verified through the windows API (a popup window is created), not by driving its UI (the popup shows the same page the tests already drive).
