import { createRequire } from 'node:module';
import { defineConfig } from 'wxt';
import { buildManifest } from './src/manifest';

const require = createRequire(import.meta.url);

export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifestVersion: 3,
  manifest: () => buildManifest(),
  vite: () => ({
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
    build: { sourcemap: false },
  }),
  hooks: {
    // SQLite WASM ships INSIDE the extension (never fetched; ADR-010). Loaded by the engine worker via an explicit locateFile.
    'build:publicAssets': (_wxt, files) => {
      files.push({ absoluteSrc: require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm'), relativeDest: 'sqlite3.wasm' });
    },
  },
  // wxt would otherwise try to open a browser in `wxt dev`; we never rely on it.
  webExt: { disabled: true },
});
