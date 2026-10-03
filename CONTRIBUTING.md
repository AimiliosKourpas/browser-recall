# Contributing

Source of truth: `BROWSER_RECALL_MASTER_BLUEPRINT.md`, then `docs/spikes/M0-RESULTS.md`, `docs/adr/`, `docs/HANDOFF.md`. Measured evidence and accepted ADRs override the blueprint.

## Setup
`npm ci` · `npm run check` (typecheck, lint, unit tests, build, built-manifest tests, size limit) · `xvfb-run -a npm run e2e` on Linux (`npm run e2e` elsewhere; the extension needs a headed Chromium).
Set `CHROMIUM_PATH` to test another Chrome/Chromium build (CI runs Chrome for Testing 116, the declared minimum).

## Rules
- Privacy is architecture: no network APIs (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`…), no `eval`/`new Function`, no `innerHTML`, no remote code or assets, no telemetry. ESLint enforces this in `src/`, `tests/` and `e2e/`; do not add disables without an ADR.
- Permissions, host patterns and the CSP live in `src/manifest.ts` and are allow-listed in `tests/manifest.test.ts`. Changing them needs an ADR and a policy-checklist update.
- Pure logic (`src/engine`, `src/shared/retry.ts`, `src/shared/errors.ts`) must not touch `chrome.*`.
- The service worker is a stateless router: register listeners synchronously, keep no durable globals.
- Write tests first for pure logic; add an e2e test for user-visible behaviour. Never add test retries or skip tests to get green.
- Prefix commit messages with the milestone when relevant (e.g. `M2: …`). Record decisions in `docs/adr/`.
