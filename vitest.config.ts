import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/built/**', 'tests/perf/**', 'tests/eval.test.ts', 'node_modules/**'], environment: 'node' },
});
