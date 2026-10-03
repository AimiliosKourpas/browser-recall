# Security policy

Browser Recall handles sensitive data (browsing history), so privacy and security reports are taken seriously.

**Report privately** through GitHub's "Report a vulnerability" (Security → Advisories) on this repository. Please do not open a public issue for vulnerabilities, and never paste real browsing data into a report.

In scope: anything that could make browsing data leave the device, expose it to web pages or other extensions, run remote code, or bypass the consent/exclusion/deletion mechanisms.

Design guarantees (verified by tests in this repository): no network permission or runtime network use (locked extension CSP, lint bans on network APIs, an end-to-end request recorder), no remote code, no telemetry, no required host permissions.
Known limitation: build-time tooling (WXT and its dependencies) has open advisories reported by `npm audit` for *development* dependencies; production dependencies are audited in CI (`npm audit --omit=dev`). Nothing from the tooling ships in the extension.
