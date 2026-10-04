# M4 results — search UI (window surface)

Branch `claude/m4-search-ui` (from `main` after M3). Verified locally on Node 22 and Chromium 141 (Chrome 116 + GitHub CI run at the final M6 gate / by CI). 

## Scope implemented
The popup-window search page (`src/ui/search/`) over the existing engine API — no search logic in the UI:
- Combobox input (autofocus, `aria-activedescendant`), listbox of `role=option` rows, polite live region ("N results" / "Searching…"), roving selection that wraps.
- Row: letter avatar (no favicons), title with engine `titleHighlights` as `<mark>` text nodes, Saved/Snippet badges, domain + shortened path, relative time (absolute on hover), TypeScript snippet with engine highlight ranges, "Title and address match" line, approximate (relaxed) matches under their own heading, "Did you mean" suggestions.
- Keyboard map (`keys.ts`, unit-tested): ↑/↓ (wrap), Enter / Shift+Enter → foreground tab and close the window, Ctrl/⌘+Enter → background tab (window stays), Esc closes, Ctrl/⌘+K focuses the filter chips, **Enter during IME composition never opens a result**.
- Filter chips (Today / 7 days / 30 days / Saved / Snippets) toggle `when:`/`is:` operators in the query text; all other operators are typed.
- States: empty-query hint, loading, no results (with Deep Search hint), error + retry, "not set up yet" notice with a button to the onboarding page when consent is missing, index-status footer (pages, import progress / "history up to date").
- Debounce 30 ms, stale responses discarded (request counter). Row actions toolbar: Copy link, Forget this page (history copy via `deleteUrls`).
- Snippet results open at their saved passage (`resultHref` adds the text fragment) — used by M5.
- i18n: all strings in the catalogue (`t()` now supports `$1` substitutions); test keeps catalogue and usage in sync.
Test-readiness signal changed from a status string to `data-engine-state="ready"` on `<main>`; existing e2e helpers updated.

## Deferred inside M4's list
"Exclude this site" row action (needs the M6 exclusion list), "Remember" row action (M5 captures from the tab, not from a result), ⌘/Ctrl+K is wired to the chip group only (a domain picker is not built).

## Tests
Unit **251/251** (new `tests/search-ui.test.ts`: keyboard map incl. IME, wrap, chips toggling, relative time, URL display, avatar, highlight splitting, snippet href). e2e **20/20** (new `e2e/search-ui.spec.ts`): setup notice before consent → consent/import through the production path → results from the real engine → typing, `<mark>` highlights, live-region count, ArrowDown/ArrowUp wrap, Ctrl+Enter background tab, Enter foreground tab + window closes, chips, exclusion operator, empty state, axe (no serious/critical violations with results on screen), IME Enter guard, Forget. typecheck/lint clean; `npm run test:built` 5/5; size JS 148.0 kB / all 555.7 kB gz (limits 160 / 620).

## Acceptance
| Criterion | Result |
|---|---|
| Real results from the real engine, keyboard-operable, open behaviours per spec | PASS |
| axe: no serious/critical violations | PASS (search page with results) |
| IME Enter does not open | PASS (unit + e2e) |
| Light/dark, reduced motion | PASS (CSS custom properties from M1; reduced-motion rule) |
| Hostile title renders as plain text | PASS by construction (text nodes only, ESLint bans innerHTML); no dedicated hostile-title e2e (add with M7) |

## Risks
No visual regression tests; latency feel measured only via engine numbers (M2). Popup window only (overlay is M7).
