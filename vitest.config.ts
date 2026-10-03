import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/built/**', 'node_modules/**'], environment: 'node' },
});
