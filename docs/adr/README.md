# Architecture decision records

| ADR | Topic | Status |
|---|---|---|
| 001 | Tiers and permission model | Accepted (store review impact unverified) |
| 002 | Search engine: SQLite FTS5 | Accepted (M0); implemented in M2 |
| 003 | UI surface: iframe overlay + popup fallback | Accepted (M0); implemented in M7 (real-site matrix is an owner manual test) |
| 004 | Service-worker-driven extraction (no content scripts in manifest) | Accepted |
| 005 | No telemetry; local diagnostics only | Accepted |
| 006 | Deletion mirroring and expiry guard | Accepted; implemented in M3 |
| 007 | Encryption at rest | Accepted (M8): not encrypted, no claim |
| 008 | No semantic search in V1 | Accepted |
| 009 | Framework: WXT + Preact + plain CSS | Accepted |
| 010 | Locked CSP and lint-enforced no-network | Accepted |
| 011 | Minimum Chrome version | Accepted: 116 (verified M1 + M2 engine + M7 overlay on Chrome 116) |
| 012 | Engine domain model, protocol and search semantics | Accepted (M2) |
| 013 | History pipeline: consent, resumable import, live sync, schedules | Accepted (M3) |
| 014 | Deep Search capture | Accepted (M6) |
| 015 | Settings, pause and data controls | Accepted (M8) |

New ADRs: copy `TEMPLATE.md`.
