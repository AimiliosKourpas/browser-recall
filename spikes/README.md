# M0 spikes (reference/evidence only)

Throwaway validation code from milestone M0. Not part of the production build, lint, tests or CI. Results: `../docs/spikes/M0-RESULTS.md`; raw outputs: `results/`.
Run: `cd spikes && npm ci && npx tsc --noEmit && npx vitest run`; full measurements: `bash run-all.sh` (~35 min, needs Chromium + xvfb).
Production code is in `../src`; reuse ideas (schema, fold, TypeScript snippets, deletion policy, harness), not files.
