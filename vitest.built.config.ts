import { defineConfig } from 'vitest/config';

// Checks against the BUILT extension (.output/chrome-mv3). Requires `npm run build` first.
export default defineConfig({ test: { include: ['tests/built/**/*.test.ts'], environment: 'node' } });
