# Architecture decision records

| ADR | Topic | Status |
|---|---|---|
| 001 | Tiers and permission model | Accepted (store review impact unverified) |
| 002 | Search engine: SQLite FTS5 | Accepted (M0); implemented in M2 |
| 003 | UI surface: iframe overlay + popup fallback | Accepted (M0); implementation M4/M7 |
| 004 | Service-worker-driven extraction (no content scripts in manifest) | Accepted |
| 005 | No telemetry; local diagnostics only | Accepted |
| 006 | Deletion mirroring and expiry guard | Accepted |
| 007 | Encryption at rest | Open (before M9) |
| 008 | No semantic search in V1 | Accepted |
| 009 | Framework: WXT + Preact + plain CSS | Accepted |
| 010 | Locked CSP and lint-enforced no-network | Accepted |
| 011 | Minimum Chrome version | Accepted: 116 (verified M1 + M2 engine; M7 overlay pending) |
| 012 | Engine domain model, protocol and search semantics | Accepted (M2) |

New ADRs: copy `TEMPLATE.md`.
