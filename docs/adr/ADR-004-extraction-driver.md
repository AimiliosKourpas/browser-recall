# ADR-004 Page text extraction is driven by the service worker — Accepted
Decision: extraction runs via `scripting.executeScript` from the service worker, after consent/exclusion/dwell checks. The manifest declares **no `content_scripts`** and no required host permissions.
Why: policy checks happen before any code touches a page; broad host access stays optional (ADR-001); a History + Saved-only release needs no host access.
Enforcement (M1): `tests/manifest.test.ts` and `tests/built/built-extension.test.ts` fail if `content_scripts`, `host_permissions` or `externally_connectable` appear; e2e verifies ordinary pages are untouched.
Implemented in M5 (Remember, via activeTab) and M6 (Deep Search).
