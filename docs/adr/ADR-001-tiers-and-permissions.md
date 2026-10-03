# ADR-001 Tiers and permission model — Accepted (review impact UNVERIFIED)
Context: History / Deep Search (opt-in, `optional_host_permissions`) / Saved (`activeTab`).
Evidence (M0): the permission set in ARCHITECTURE §3 + optional hosts + locked CSP loads in Chromium 141 with no manifest errors or install warnings. The Chrome Web Store reaction (in-depth-review banner, dashboard privacy checkboxes) is **NOT TESTED** — needs a developer account.
Decision: keep the design. Fallback if review is unworkable: release R1 (History + Saved only, no optional hosts).
Open action (owner): unlisted draft upload before M9; record banner text in docs/spikes/M0-RESULTS.md.
