import { defineConfig } from 'vitest/config';

// Production-engine performance guards at 20K pages (`npm run test:perf`). Slow by design; kept out of `npm test`.
export default defineConfig({ test: { include: ['tests/perf/**/*.test.ts'], environment: 'node', testTimeout: 600_000 } });
