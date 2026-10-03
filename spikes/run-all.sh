#!/usr/bin/env bash
# Reproduces every M0 measurement. Needs: npm ci, Chromium (PLAYWRIGHT path), xvfb-run. Takes ~35 min.
set -u
cd "$(dirname "$0")/.."
node spikes/browser/build.mjs
npx vitest run                                              | tee spikes/results/vitest.txt
npx tsx spikes/engine/node-bench.ts 5000,20000,50000        > spikes/results/node-bench.txt
npx tsx spikes/engine/size-levers.ts 20000                  > spikes/results/size-levers.txt
npx tsx spikes/engine/profile.ts 20000                      > spikes/results/snippet-profile.txt
xvfb-run -a node spikes/browser/bench-engine.mjs 5000,20000,50000 > spikes/results/bench-engine.txt
xvfb-run -a node spikes/browser/bench-memory.mjs 20000,50000      > spikes/results/bench-memory.txt
xvfb-run -a node spikes/browser/resilience.mjs              > spikes/results/resilience.txt
xvfb-run -a node spikes/browser/soak.mjs 15                 > spikes/results/soak.txt
xvfb-run -a node spikes/browser/history-scale.mjs 100000    > spikes/results/history-scale.txt
xvfb-run -a node spikes/browser/deletion.mjs                > spikes/results/deletion.txt
xvfb-run -a node spikes/browser/expiry.mjs 15               > spikes/results/expiry.txt
xvfb-run -a node spikes/browser/overlay.mjs test            > spikes/results/overlay.txt
xvfb-run -a node spikes/browser/overlay.mjs dyn             > spikes/results/overlay-dyn.txt
xvfb-run -a node spikes/browser/dynamic-url.mjs             > spikes/results/dynamic-url.txt
xvfb-run -a node spikes/browser/csp-shortcuts.mjs           > spikes/results/csp-shortcuts.txt
