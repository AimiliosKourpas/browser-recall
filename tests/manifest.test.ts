import { describe, expect, it } from 'vitest';
import { EXTENSION_PAGES_CSP, E2E_HOST_PERMISSIONS, buildManifest } from '../src/manifest';

// Deliberate, ADR-001-backed allowlist. Changing the manifest permissions/hosts/CSP requires editing THIS file (and the ADR).
const ALLOWED_PERMISSIONS = ['history', 'storage', 'unlimitedStorage', 'contextMenus', 'activeTab', 'scripting', 'offscreen', 'alarms'];
const ALLOWED_OPTIONAL_HOSTS = ['https://*/*', 'http://*/*'];
const FORBIDDEN = ['tabs', 'webNavigation', 'bookmarks', 'cookies', 'webRequest', 'webRequestBlocking', 'favicon', 'downloads', 'management', 'declarativeNetRequest', 'identity', 'nativeMessaging', 'proxy', 'debugger'];

describe('manifest allowlist (ADR-001)', () => {
  const m = buildManifest();
  it('permissions equal the allowlist exactly', () => {
    expect([...m.permissions].sort()).toEqual([...ALLOWED_PERMISSIONS].sort());
  });
  it('no forbidden permission and NO required host access', () => {
    for (const p of FORBIDDEN) expect(m.permissions).not.toContain(p);
    expect(m).not.toHaveProperty('host_permissions');
    expect(m).not.toHaveProperty('content_scripts');
    expect(m).not.toHaveProperty('externally_connectable');
  });
  it('the only web-accessible resource is the search page, for http(s) pages, with a dynamic URL (ADR-003)', () => {
    expect(m.web_accessible_resources).toEqual([{ resources: ['search.html'], matches: ['https://*/*', 'http://*/*'], use_dynamic_url: true }]);
  });
  it('broad host access is optional only', () => {
    expect([...m.optional_host_permissions]).toEqual(ALLOWED_OPTIONAL_HOSTS);
  });
  it('the production manifest has no host_permissions; only the e2e build adds the fixture host', () => {
    expect(buildManifest()).not.toHaveProperty('host_permissions');
    expect(buildManifest({ e2e: true }).host_permissions).toEqual([...E2E_HOST_PERMISSIONS]);
    expect(E2E_HOST_PERMISSIONS).toEqual(['http://fixture.test/*']);
  });
  it('minimum Chrome version is declared', () => {
    expect(m.minimum_chrome_version).toBe('116');
  });
  it('declares the search shortcut with a Ctrl/Command modifier and no Ctrl+Alt', () => {
    const key = m.commands['open-search'].suggested_key;
    expect(key.default).toMatch(/^Ctrl\+/);
    expect(key.default).not.toMatch(/Alt/);
    expect(key.mac).toMatch(/^Command\+/);
  });
});

describe('extension_pages CSP (ADR-010)', () => {
  const directives = Object.fromEntries(EXTENSION_PAGES_CSP.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name as string, values]));
  it('is locked down', () => {
    expect(directives['default-src']).toEqual(["'none'"]);
    expect(directives['connect-src']).toEqual(["'none'"]);
    expect(directives['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives['form-action']).toEqual(["'none'"]);
    expect(directives['frame-src']).toEqual(["'none'"]);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['img-src']).toEqual(["'self'", 'data:']);
  });
  it("never allows eval, inline scripts or any remote origin", () => {
    expect(EXTENSION_PAGES_CSP).not.toMatch(/(?<!wasm-)unsafe-eval|unsafe-inline|https?:|\*/);
  });
});
