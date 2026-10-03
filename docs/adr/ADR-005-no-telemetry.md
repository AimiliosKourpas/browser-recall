# ADR-005 No telemetry; local diagnostics only — Accepted
Decision: no analytics, crash reporting, remote config, update pings or any runtime network use, ever. Diagnostics are a user-initiated "Copy diagnostics" of counts and versions (no URLs, no text), implemented in M8.
Enforcement: locked extension CSP (`connect-src 'none'`, ADR-010) — M0 S5 showed it stops every probe from page, worker and service worker; ESLint bans network APIs in `src`, `tests`, `e2e`; e2e probe (`e2e/foundation.spec.ts`) asserts zero requests reach a recording server; the built bundle is scanned for remote URLs. A full-scenario recorder over all contexts arrives in M8.
Consequence: no usage data; product validation relies on surveys, store stats and user-pasted diagnostics (risk R11).
