import { defineConfig } from 'vitest/config';

// Relevance eval harness (`npm run test:eval`): ~20 s, runs in CI.
export default defineConfig({ test: { include: ['tests/eval.test.ts'], environment: 'node', testTimeout: 120_000 } });
