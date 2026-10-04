# Changelog
All notable changes to Browser Recall. Format: Keep a Changelog; versioning: SemVer. Every release must note changes to permissions or data practices.

## [Unreleased]
### Added (M3 history pipeline)
- Consent gate (versioned) with an onboarding consent screen; nothing is read before consent.
- Resumable bounded import of Chrome history, live sync, mirrored deletion with the 85-day Chrome-expiry guard, daily reconcile/maintenance alarms, engine `lastVisits`.

### Added (M2 engine core)
- SQLite FTS5 search engine on OPFS (offscreen-hosted single-owner worker): schema v1 + migrations, history/content/saved/snippet writes, deletion semantics, query language (site:, after:, before:, when:, is:saved, is:snippet, phrases, exclusions), ranking, relaxation, "did you mean", Greek/Latin folding, TypeScript snippets, bounded incremental vacuum, retention and storage cap, export/import, integrity checks.
- Typed engine protocol over the service worker; relevance eval harness; engine performance guards; SQLite WASM bundled (package ≈ 546 kB zipped).

### Added (M1 foundation)
- WXT + TypeScript (strict) + Preact scaffold, locked extension CSP, permission allowlist with snapshot tests.
- Typed, validated messaging; stateless service worker; offscreen document hosting an engine worker (ping only); search and onboarding stub pages; i18n scaffold.
- ESLint privacy/security bans (network APIs, eval, innerHTML, remote imports) with tests; Vitest unit tests; Playwright e2e (persistent context, fixture server, axe); GitHub Actions CI incl. a minimum-Chrome (116) job.
