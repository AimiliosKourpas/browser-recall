# M6 results — Deep Search capture

Branch `claude/m6-deep-search` (from `claude/m5-remember-saved`). Verified locally: Chromium 141 (full e2e) and Chrome for Testing 116 (new M4/M5/M6 specs). GitHub CI not run on this branch.

## Implemented
- **Opt-in capture** (`src/background/deep/capture.ts`, ADR-014): `tabs.onUpdated` complete → gates (enabled, consent, permission held for the origin, eligible URL, not incognito, not excluded) → injected `extractPage({deep:true, minTextLength:200})` → `upsertContent` with a SHA-256 hash. Skips password/payment-field pages, non-HTML, too little text, private/intranet/IP hosts, URLs with credentials.
- **Settings page** (`settings.html`, linked from the search footer): explanation, Turn on/off, excluded sites (adding one deletes its Deep text and stops capture), "Delete all Deep Search text". The permission prompt comes from the button click; the service worker verifies the permission before enabling and `permissions.onRemoved` / every wake switches capture off if it is gone. Disabling gives the optional access back.
- **Engine**: `clearDeepContent({domain?})` (Deep-only pages deleted; pages in history keep their row; saved pages untouched). No schema change.
- **State**: `br:state.deep {enabled, enabledAt, excluded[]}` (defaults make older stored state valid).
- **Messages**: `sw/deep-status|enable|disable|exclude|include|clear` (validated, trusted-extension-page only).
- **Manifest**: unchanged. Deep Search uses the already-declared optional `https://*/*`, `http://*/*`. The built-output URL scan allows exactly those two match patterns.

## Tests
Unit **301/301** (new `tests/deep.test.ts`, 28 tests: every capture gate, eligibility table, duplicate/update, caps, history interplay, controller enable/disable/reconcile, exclude/clear semantics, old-state parse). typecheck, lint clean; built 5/5; eval 1/1; `npm audit --omit=dev` 0. Size: JS 154.35 kB (limit 160), all files 563.29 kB gz (limit 620); growth vs M5 +3.8 / +4.9 kB (settings page + capture logic).
e2e **24/24** Chromium 141 incl. new `e2e/deep-search.spec.ts`: off by default (page visited, body not indexed) → enable → capture → body-only phrase found as source `deep` (boilerplate not) → reload keeps one page → password and too-short pages not captured → search UI finds it → service-worker restart keeps state and index → exclude via the settings UI deletes that site's Deep text and blocks recapture → un-exclude → disable: History and Saved keep working, nothing new captured, integrity ok → "Delete all Deep Search text" keeps the history row and the saved page. Production-build test: no host permission held; `deep-enable` refused (`permission-required`); History + Saved work; settings page shows off. Chrome 116: deep-search, search-ui, remember specs pass. Existing M2/M3 regression specs and the no-egress checks in the pipeline spec pass unchanged; engine perf guards not re-run (no engine hot-path change).

## Deviations / honest limits
- **Permission prompt and removal are not driven in a browser.** Playwright cannot accept `permissions.request` or remove a required permission, so e2e uses the e2e build (required `fixture.test` host permission) and drives enable via the message; denial is covered on the production build (permission absent → refusal), removal by unit tests of `reconcile`. The real prompt flow needs a manual check before publishing.
- No dwell-time threshold: capture happens at load complete. SPA route changes without a load event are not captured. Content updates only on a new load.
- Excludes are per registrable-style domain (subdomains included); no per-page "never index" or built-in sensitive-site list beyond the structural rules.

## Risks
Manual verification of the optional-permission prompt wording/flow; capture cost on heavy pages (extractor runs once per load, bounded by caps); Chrome Web Store reviewers may question broad optional host access (justification: ADR-001/014, off by default).
