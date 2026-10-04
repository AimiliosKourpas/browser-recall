# Release checklist (V1, Chrome Web Store)

Status after M8: implementation complete; everything below is release work. Production package: `npm ci && npm run build && npm run zip` → `.output/browser-recall-<version>-chrome.zip` (≈576 kB; no source maps, no e2e output, manifest without `host_permissions`/`content_scripts`/`icons`).

## TODAY: ordered manual QA in real Chrome (about 45 minutes; do this on the exact zip contents)
Prepare: add the icons (`docs/STORE-ASSETS.md`), then `npm ci && npm run build && npm run release:check && npm run zip`. Unzip `.output/browser-recall-0.1.0-chrome.zip` to a folder and use that folder below (this is what the store receives). Use a **fresh Chrome profile** with some browsing history.
1. `chrome://extensions` → Developer mode → **Load unpacked** → the unzipped folder. No errors in the card; icon shows; open "service worker" DevTools and keep it open for errors.
2. **Onboarding** opens by itself. Read it: local-first, why History, Deep Search optional, how to search/Remember. Press **Allow and import history**; wait for "Import complete".
3. **Search**: click the toolbar icon (or `chrome://extensions/shortcuts` to see/assign shortcuts first). Type part of a known page title; results appear; Enter opens it.
4. **Shortcut + overlay** on 4 pages: a news article, GitHub, YouTube (video playing: space/k must not act on the video while typing), and a `chrome://extensions` page (expect the small window). Esc closes; focus returns to the page.
5. **Remember page**: right-click an article → "Remember this page"; badge ✓; search a word from its body → "Saved" result. **Save selection**: select a sentence → right-click → "Save selection to memory"; search it → "Snippet"; open it → jumps to the passage.
6. **Settings** (search footer → "Deep Search settings"): index summary correct; Pause → badge "II" → Resume; retention/limit selectors persist after reload; "What is stored" lists sites; page lookup works.
7. **Restart/persistence**: quit Chrome fully, reopen: search still works, no re-import, settings kept, nothing paused unexpectedly.
8. **Deep Search disabled baseline**: Settings shows "off"; `chrome://extensions` → Details → Site access shows nothing granted. Visit an article; a phrase from its body is NOT found.
9. **Enable → real prompt**: press "Turn on Deep Search"; Chrome's permission prompt appears. **Deny**: stays off, message shown, History + Saved still work. Press again and **Allow**: status "on".
10. **Content search**: open an article (not previously visited), wait ~10 s, search a mid-article phrase → found (labelled Deep). Check the password-page skip: open any login page; its text is not found.
11. **Revoke through Chrome**: `chrome://extensions` → Details → Site access → remove/"On click". Reload Settings: Deep Search shows paused; browse: no new body text; History + Saved + search still fine, no errors in the service-worker console.
12. **Re-grant**: Turn on again → prompt → works; capture resumes.
13. **Delete Deep Search data**: Settings → "Delete all Deep Search text": body-text search stops finding the article; its history title still found; remembered page and snippet still found.
14. **Package smoke test**: `chrome://extensions` → remove the extension → load the unzipped folder again as clean install; repeat steps 2–3 quickly. In both the service-worker DevTools and an extension page's Network tab confirm **no requests**.
15. Overlay smoke set beyond step 4 only if time permits (`docs/qa/overlay-matrix.md`): Google Docs, a PDF, a login page, a fullscreen video. A fallback to the small window is a PASS; a page receiving the typed keys, or the page stuck inert after Esc, is a FAIL (stop and report).
Windows/macOS shortcut check (section C) is part of step 3/4 on whichever OS you use; if the default shortcut is unassigned, the store listing still works (the toolbar icon and the user-assigned shortcut).

## A. BLOCKERS BEFORE SUBMISSION (state after release-prep)
1. **Icons**: not in the repository. Supply `public/icons/{16,32,48,128}.png` (`docs/STORE-ASSETS.md`); `npm run release:check` fails until they are valid. Nothing else is needed in code (WXT adds the manifest `icons`).
2. **Manual QA above** (permission prompt, shortcuts, overlay smoke, package smoke test).
3. ~~Privacy policy placeholders~~ **DONE**: publisher, contact and effective date are filled, and the policy is public at https://aimilioskourpas.github.io/browser-recall/PRIVACY-POLICY (GitHub Pages, `main` `/docs`). Paste that exact URL into the dashboard's privacy policy field; re-check that it still loads before submitting.
4. **Screenshots (≥ 1) and the 440×280 small promo tile** (`docs/STORE-ASSETS.md`).
5. **Dashboard entries**: copy from `docs/STORE-LISTING.md`; publisher/trader declaration; support contact; visibility (recommend Unlisted first). Confirm the "Browser Recall" name is acceptable/not trademarked (store may reject on name).

## B. Manual test: optional host permission (owner, real Chrome, production zip loaded unpacked or as a draft upload)
1. Clean profile: install the extension. The welcome page opens.
2. Allow history access; the import finishes; search finds old pages by title.
3. Settings → Deep Search shows **off**; `chrome://extensions` → Details → "Site access" shows no access.
4. Settings → "Turn on Deep Search": Chrome shows its **permission prompt** (read all sites).
5. **Deny**: Deep Search stays off with a message; History search and remembered items still work.
6. Turn on again and **Allow**: status becomes "on".
7. Open a page whose text is not in its title (an article); wait a few seconds; search for a phrase from the body → found, labelled as Deep.
8. In `chrome://extensions` → Details → Site access, remove the access (set to "On click").
9. Reload Settings: Deep Search shows "paused: access was removed"; no new body text is captured; no error.
10. History search and remembered pages/snippets still work; Settings → Delete shows the index intact.
11. Turn Deep Search on again → prompt again → works.

## C. Manual test: shortcuts (Windows, macOS, Linux)
- Defaults: search Ctrl+Shift+Y / ⌘+Shift+Y; Remember page Ctrl+Shift+U / ⌘+Shift+U (suggested, not guaranteed). On each OS check `chrome://extensions/shortcuts` shows them assigned (if blank, another extension/app owns it) and that Settings → Shortcuts shows the same.
- Press the search shortcut on a normal page: overlay opens with focus in the input; Esc closes; on a `chrome://` page the small window opens.
- Greek keyboard layout on Windows: confirm Ctrl+Shift does not trigger a layout switch conflict.

## D. Manual test: overlay on real pages — `docs/qa/overlay-matrix.md` (15 rows).

## E. Manual test: packaging and basics
- Load the zip contents unpacked on Chrome stable and on Chrome 116 (minimum): no console errors in the service worker or pages; first-run flow; search, Remember, snippet, delete, export/import round trip; restart the browser and confirm everything persists and nothing re-imports.
- Uninstall, reinstall: clean state.
- Screen reader smoke test (NVDA/VoiceOver) on the search overlay and settings (axe is automated; this is the manual pass the blueprint asks for).

## F. Non-blocking / post-V1
- Greek (or other) localisation; only English strings ship.
- Real-site overlay matrix failures would only change the surface (the window fallback is complete).
- Per-page "never index", dwell-time and SPA route-change capture for Deep Search; built-in sensitive-site list beyond the structural rules.
- Passphrase encryption (ADR-007), diagnostics beyond counts, Edge/Brave verification.
- Engine perf guards in CI run on main only (unchanged).

## G. Licence / name
MIT (`LICENSE`, "Browser Recall contributors"): confirm the copyright holder name for the store/legal pages. Product name unresolved until the trademark/store-name check (A4).

## H. Known behaviours to mention in reviewer instructions
Deep Search needs the permission prompt (give reviewers a step list from section B); history is imported only after the user presses Allow; nothing is sent anywhere (reviewers can verify with DevTools Network on the service worker and extension pages).
