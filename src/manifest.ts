// Single source of truth for the extension manifest (ADR-001, ADR-010). Consumed by wxt.config.ts and snapshot-tested.
// Adding a permission, host pattern or CSP directive here must be a deliberate, ADR-backed change: tests/manifest.test.ts
// compares against an explicit allowlist and fails otherwise.

export const PERMISSIONS = ['history', 'storage', 'unlimitedStorage', 'contextMenus', 'activeTab', 'scripting', 'offscreen', 'alarms'] as const;

/** Deep Search host access is OPTIONAL and requested at runtime from a user gesture (ADR-001). */
export const OPTIONAL_HOST_PERMISSIONS = ['https://*/*', 'http://*/*'] as const;

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

export function buildManifest() {
  return {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    minimum_chrome_version: MINIMUM_CHROME_VERSION,
    permissions: [...PERMISSIONS],
    optional_host_permissions: [...OPTIONAL_HOST_PERMISSIONS],
    action: { default_title: '__MSG_actionTitle__' },
    commands: {
      'open-search': {
        suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
        description: '__MSG_cmdOpenSearch__',
      },
    },
    content_security_policy: { extension_pages: EXTENSION_PAGES_CSP },
  };
}
