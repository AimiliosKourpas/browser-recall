// Builds spike extension variants into spikes/browser/dist/<variant>.
//   base    : production-like permission set (ARCHITECTURE §3), no host_permissions
//   test    : base + http://127.0.0.1/* host permission + browsingData (test-only: Playwright cannot click the action / grant optional hosts)
//   dyn     : test + web_accessible_resources use_dynamic_url
//   dup     : test with a different name (shortcut-conflict test)
//   nocsp   : base with Chrome's default extension CSP (control: shows what leaks without connect-src 'none')
//   badcsp  : base with a CSP Chrome should reject (control for the CSP experiment)
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['base', 'test', 'dyn', 'dup', 'badcsp', 'nocsp'];

const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

function manifest(v) {
  const m = {
    manifest_version: 3,
    name: v === 'dup' ? 'BR Spike Dup' : 'BR Spike',
    version: '0.0.1',
    minimum_chrome_version: '116',
    description: 'Browser Recall M0 spike. Throwaway.',
    permissions: ['history', 'storage', 'unlimitedStorage', 'contextMenus', 'activeTab', 'scripting', 'offscreen', 'alarms'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    background: { service_worker: 'sw.js' },
    action: { default_title: 'Search' },
    commands: {
      'open-search': { suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' }, description: 'Open search' },
    },
    web_accessible_resources: [{ resources: ['search.html', 'search.js'], matches: ['<all_urls>'] }],
    content_security_policy: { extension_pages: CSP },
  };
  if (['test', 'dyn', 'dup'].includes(v)) {
    m.host_permissions = ['http://127.0.0.1/*'];
    m.permissions.push('browsingData');
  }
  if (v === 'dyn') m.web_accessible_resources[0].use_dynamic_url = true;
  if (v === 'nocsp') delete m.content_security_policy;
  if (v === 'nocsp') m.host_permissions = ['http://127.0.0.1/*'];
  if (v === 'badcsp') m.content_security_policy = { extension_pages: "script-src 'self' https://evil.example; object-src 'self'" };
  return m;
}

for (const v of variants) {
  const out = join(here, 'dist', v);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const common = { bundle: true, target: 'chrome116', logLevel: 'warning', sourcemap: false };
  await build({ ...common, entryPoints: { sw: join(here, 'src/sw.ts'), offscreen: join(here, 'src/offscreen.ts'), 'overlay-host': join(here, 'src/overlay-host.ts'), search: join(here, 'src/search.ts'), bench: join(here, 'src/bench.ts') }, outdir: out, format: 'iife' });
  await build({ ...common, entryPoints: { 'engine-worker': join(here, 'src/engine-worker.ts') }, outdir: out, format: 'esm' });
  copyFileSync(join(root, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), join(out, 'sqlite3.wasm'));
  for (const [n, js] of [['offscreen', 'offscreen.js'], ['search', 'search.js'], ['bench', 'bench.js']]) {
    const body = n === 'search' ? '<input id="q" autocomplete="off" aria-label="Search"><ul id="results"></ul><div id="status"></div>' : '';
    writeFileSync(join(out, `${n}.html`), `<!doctype html><meta charset="utf-8"><title>${n}</title>${body}<script src="${js}"></script>`);
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest(v), null, 2));
  console.log('built', v);
}
