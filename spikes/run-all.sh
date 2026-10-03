#!/usr/bin/env bash
# Reproduces every M0 measurement. Needs: npm ci, Chromium (PLAYWRIGHT path), xvfb-run. Takes ~35 min.
set -u
cd "$(dirname "$0")"
node browser/build.mjs
npx vitest run                                              | tee results/vitest.txt
npx tsx engine/node-bench.ts 5000,20000,50000        > results/node-bench.txt
npx tsx engine/size-levers.ts 20000                  > results/size-levers.txt
npx tsx engine/profile.ts 20000                      > results/snippet-profile.txt
xvfb-run -a node browser/bench-engine.mjs 5000,20000,50000 > results/bench-engine.txt
xvfb-run -a node browser/bench-memory.mjs 20000,50000      > results/bench-memory.txt
xvfb-run -a node browser/resilience.mjs              > results/resilience.txt
xvfb-run -a node browser/soak.mjs 15                 > results/soak.txt
xvfb-run -a node browser/history-scale.mjs 100000    > results/history-scale.txt
xvfb-run -a node browser/deletion.mjs                > results/deletion.txt
xvfb-run -a node browser/expiry.mjs 15               > results/expiry.txt
xvfb-run -a node browser/overlay.mjs test            > results/overlay.txt
xvfb-run -a node browser/overlay.mjs dyn             > results/overlay-dyn.txt
xvfb-run -a node browser/dynamic-url.mjs             > results/dynamic-url.txt
xvfb-run -a node browser/csp-shortcuts.mjs           > results/csp-shortcuts.txt
