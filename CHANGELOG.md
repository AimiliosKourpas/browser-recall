# Changelog
All notable changes to Browser Recall. Format: Keep a Changelog; versioning: SemVer. Every release must note changes to permissions or data practices.

## [Unreleased]
### Added (M1 foundation)
- WXT + TypeScript (strict) + Preact scaffold, locked extension CSP, permission allowlist with snapshot tests.
- Typed, validated messaging; stateless service worker; offscreen document hosting an engine worker (ping only); search and onboarding stub pages; i18n scaffold.
- ESLint privacy/security bans (network APIs, eval, innerHTML, remote imports) with tests; Vitest unit tests; Playwright e2e (persistent context, fixture server, axe); GitHub Actions CI incl. a minimum-Chrome (116) job.
