import { defineConfig } from 'wxt';
import { buildManifest } from './src/manifest';

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifestVersion: 3,
  manifest: () => buildManifest(),
  vite: () => ({
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
    build: { sourcemap: false },
  }),
  // wxt would otherwise try to open a browser in `wxt dev`; we never rely on it.
  webExt: { disabled: true },
});
