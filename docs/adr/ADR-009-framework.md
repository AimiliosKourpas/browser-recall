# ADR-009 Framework: WXT + Preact + plain CSS — Accepted
Confirmed in M1 (WXT 0.20, Vite 7, Preact 10, TypeScript 5.9 strict, zod 4, Vitest 3, Playwright 1.56). Build output is a normal MV3 folder/zip with a hand-checkable manifest (a plain-Vite exit path remains possible).
Decisions and deviations found while building:
- **npm, not pnpm** (blueprint §12): no pnpm in the environment; a single `package-lock.json` keeps the supply chain simple. Revisit only if install speed matters.
- **Preact via esbuild `jsx: 'automatic'` + `jsxImportSource: 'preact'`** — no extra Vite plugin dependency.
- **The engine worker is a WXT unlisted script** (`src/entrypoints/engine-worker.ts` → `engine-worker.js`, classic worker started with `new Worker(chrome.runtime.getURL('/engine-worker.js'))`). The `new Worker(new URL(…, import.meta.url), {type:'module'})` form did NOT emit the worker file from an HTML entrypoint (WXT rewrote `import.meta.url`); M2 must load `sqlite3.wasm` with an explicit `locateFile` to a `public/` asset.
- Manifest is generated from `src/manifest.ts` (single source of truth, unit-snapshotted); i18n strings via `_locales/en`.
- `srcDir: 'src'`; thin entrypoints under `src/entrypoints/` import from `src/background`, `src/engine`, `src/shared`, `src/ui`.
- zod costs ~30 kB gzip per bundle that uses it (service-worker chunk and the worker). Accepted; size budget in `package.json` (`size-limit`) is re-baselined in M2 when sqlite WASM (~0.9 MB) lands.
- Toolchain (dev) dependencies carry `npm audit` advisories (web-ext transitive); production dependencies are clean and CI audits them (`--omit=dev`).
