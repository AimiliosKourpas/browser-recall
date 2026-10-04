// Single source of truth for the extension manifest (ADR-001, ADR-010). Consumed by wxt.config.ts and snapshot-tested.
// Adding a permission, host pattern or CSP directive here must be a deliberate, ADR-backed change: tests/manifest.test.ts
// compares against an explicit allowlist and fails otherwise.

export const PERMISSIONS = ['history', 'storage', 'unlimitedStorage', 'contextMenus', 'activeTab', 'scripting', 'offscreen', 'alarms'] as const;

/** Deep Search host access is OPTIONAL and requested at runtime from a user gesture (ADR-001). */
export const OPTIONAL_HOST_PERMISSIONS = ['https://*/*', 'http://*/*'] as const;

export const OVERLAY_RESOURCES = ['search.html'] as const;
export const OVERLAY_MATCHES = ['https://*/*', 'http://*/*'] as const;

/** Locked-down CSP validated in M0 (S5): blocks every outbound request from every extension context. */
export const EXTENSION_PAGES_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'none'",
  "img-src 'self' data:",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

/** Chrome 116 introduced runtime.getContexts, which the offscreen manager relies on. Unverified below 141 except via the compat job (ADR-011). */
export const MINIMUM_CHROME_VERSION = '116';

/**
 * E2E-only build (BR_E2E=1 → .output-e2e): Playwright cannot click the toolbar, press browser shortcuts or accept the optional-host
 * permission prompt, so tests need a host permission for the fixture host. The production manifest never contains it;
 * tests/manifest.test.ts and tests/built assert that.
 */
export const E2E_HOST_PERMISSIONS = ['http://fixture.test/*'] as const;

export function buildManifest(opts: { e2e?: boolean } = {}) {
  return {
    ...(opts.e2e ? { host_permissions: [...E2E_HOST_PERMISSIONS] } : {}),
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: MINIMUM_CHROME_VERSION,
    permissions: [...PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
    // M7 overlay: the search page may be framed by web pages (the injected overlay host). use_dynamic_url hides the static URL from page probing (ADR-003).
    web_accessible_resources: [{ resources: [...OVERLAY_RESOURCES], matches: [...OVERLAY_MATCHES], use_dynamic_url: true }],
    action: { default_title: '__MSG_actionTitle__' },
    commands: {
      'open-search': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: '__MSG_cmdOpenSearch__',
      },
      'remember-page': {
        suggested_key: { default: 'Ctrl+Shift+U', mac: 'Command+Shift+U' },
        description: '__MSG_cmdRememberPage__',
      },
    },
    content_security_policy: { extension_pages: EXTENSION_PAGES_CSP },
  };
}
