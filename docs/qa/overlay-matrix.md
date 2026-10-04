# Overlay manual matrix (owner, real Chrome)
Fixtures are automated (`e2e/overlay.spec.ts`). Real sites were NOT exercised in the cloud session (no network by design). Run before release with the production build; for each row: invoke the shortcut (or toolbar icon), confirm the box appears and typing works immediately, type a query, Enter opens a result, reopen, Esc closes and focus returns to where it was. Record pass/fail; any fallback to the small popup window is also a PASS (it is the designed fallback) as long as no error is shown.

| # | Page type | Expect | Result |
|---|---|---|---|
| 1 | News article | overlay |  |
| 2 | GitHub repo page | overlay (GitHub may steal `/` and other keys: none must reach it) |  |
| 3 | Google Docs | overlay or window; typing never edits the doc |  |
| 4 | YouTube video (playing) | overlay; video keys (space, k) must not act |  |
| 5 | Chrome PDF viewer | window fallback acceptable |  |
| 6 | Bank-like login page | overlay or window; nothing typed reaches the page |  |
| 7 | `file://` page | window unless "Allow access to file URLs" is on |  |
| 8 | New tab page / `chrome://` page | window |  |
| 9 | Page with iframes | overlay |  |
| 10 | Fullscreen video | overlay above fullscreen, or window |  |
| 11 | Login page with autofocus field | overlay; autofocus must not take typing |  |
| 12 | Wikipedia article | overlay |  |
| 13 | Long forum thread (scrolled down) | overlay; page scroll position unchanged after Esc |  |
| 14 | SPA (e.g. a web mail) | overlay; app shortcuts must not fire |  |
| 15 | Intranet page | overlay or window |  |

Decision gate (blueprint): if reliability across the matrix is poor, ship popup-window only by removing the injection call in `src/background/open-search.ts` (the window path is unchanged).
