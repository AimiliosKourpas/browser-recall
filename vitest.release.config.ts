import { defineConfig } from 'vitest/config';

// Pre-upload gate for the Chrome Web Store package (`npm run release:check`). Requires `npm run build` first. Not part of CI:
// it fails until the owner has supplied the production icons (public/icons/{16,32,48,128}.png).
export default defineConfig({ test: { include: ['tests/release/**/*.test.ts'], environment: 'node' } });
