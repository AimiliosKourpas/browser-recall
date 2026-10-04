# Release checklist (V1, Chrome Web Store)

Status after M8: implementation complete; everything below is release work. Production package: `npm ci && npm run build && npm run zip` → `.output/browser-recall-<version>-chrome.zip` (≈576 kB; no source maps, no e2e output, manifest without `host_permissions`/`content_scripts`/`icons`).

## A. BLOCKERS BEFORE SUBMISSION
1. **No extension icons.** `manifest.json` has no `icons` and `public/` has none. The store requires a 128×128 icon (also supply 16/32/48 and the toolbar `action.default_icon`). Needs a design decision and files, then `icons`/`action.default_icon` in `src/manifest.ts` (the manifest allowlist test must be updated deliberately).
2. **Manual real-Chrome verification not done** (sections B–E). The optional-permission prompt, real shortcut/toolbar activeTab grant and real-site overlay matrix cannot be automated in the cloud environment.
3. **Privacy policy is a draft** (`docs/PRIVACY-POLICY.md`): needs publisher name, contact/support email or issue URL, effective date, and a public URL (e.g. GitHub Pages) for the dashboard field.
4. **Store listing assets and text not produced**: name decision/trademark check ("Browser Recall"), short + detailed description, ≥1 (ideally 5) 1280×800 or 640×400 screenshots, small promo tile 440×280, category, support contact.
5. **Dashboard declarations not prepared**: single-purpose statement, per-permission justifications (use `docs/PERMISSIONS.md`), data-usage disclosures (collects web history and website content; none transmitted off device; Limited Use certification), remote-code answer "No", trader/non-trader declaration, visibility (recommend unlisted for the first submission).

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
