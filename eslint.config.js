// Privacy/security guardrails (ADR-010, blueprint M1). The restrictions below make accidental network access, remote code
// and unsafe DOM writes fail lint. They apply to src/, tests/ AND e2e/ (a banned API in a test file fails too).
// tests/lint-rules.test.ts exercises every rule against this very config.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts'];
const restrictedGlobals = (extra = []) => [
  ...NETWORK_GLOBALS.map((name) => ({ name, message: 'Network APIs are banned: Browser Recall never makes network requests (ADR-005, ADR-010).' })),
  ...extra,
];

const restrictedProperties = [
  { object: 'navigator', property: 'sendBeacon', message: 'sendBeacon is banned (no network, ADR-010).' },
  ...['window', 'self', 'globalThis', 'chrome', 'browser'].map((object) => ({ object, property: 'fetch', message: 'fetch is banned (no network, ADR-010).' })),
  ...['window', 'self', 'globalThis'].flatMap((object) =>
    ['XMLHttpRequest', 'WebSocket', 'EventSource'].map((property) => ({ object, property, message: `${property} is banned (no network, ADR-010).` })),
  ),
];

const restrictedSyntax = [
  { selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]", message: 'innerHTML/outerHTML are banned: render text nodes only (ADR-010).' },
  { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'insertAdjacentHTML is banned (ADR-010).' },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]", message: 'document.write is banned (ADR-010).' },
  { selector: 'CallExpression[callee.name=/^(setTimeout|setInterval)$/][arguments.0.type=/^(Literal|TemplateLiteral)$/]', message: 'String arguments to setTimeout/setInterval are implied eval (ADR-010).' },
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is banned (ADR-010).' },
  { selector: 'ImportExpression:not([source.type="Literal"])', message: 'Dynamic import() of a non-literal specifier is banned (remote/computed code, ADR-010).' },
  { selector: 'ImportExpression[source.value=/^(https?:)?\\/\\//]', message: 'Importing code from a URL is banned (no remote code, ADR-010).' },
  { selector: 'NewExpression[callee.name="Worker"][arguments.0.type="Literal"][arguments.0.value=/^(https?:)?\\/\\//]', message: 'Workers must be bundled, not remote (ADR-010).' },
  { selector: 'NewExpression[callee.name="Worker"][arguments.0.type="TemplateLiteral"]', message: 'Worker URLs must be chrome.runtime.getURL() of a bundled file (ADR-010).' },
];

const guarded = ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'];

export default tseslint.config(
  { ignores: ['.output/**', '.output-e2e/**', '.wxt/**', 'node_modules/**', 'spikes/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: guarded,
    rules: {
      'no-restricted-globals': ['error', ...restrictedGlobals()],
      'no-restricted-properties': ['error', ...restrictedProperties],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
      'no-restricted-imports': ['error', { patterns: [{ regex: '^(https?:)?//', message: 'Remote imports are banned (ADR-010).' }] }],
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Pure core: no chrome.* / browser.* here, so it runs in Node tests and in the worker (ARCHITECTURE §7).
    files: ['src/engine/**/*.ts', 'src/shared/retry.ts', 'src/shared/errors.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...restrictedGlobals([
          { name: 'chrome', message: 'src/engine and pure shared modules must not use chrome.* (keep the core testable).' },
          { name: 'browser', message: 'src/engine and pure shared modules must not use browser.*.' },
        ]),
      ],
    },
  },
  {
    // Node-side tooling (configs, scripts) is not extension code.
    files: ['*.config.{js,ts}', 'scripts/**'],
    languageOptions: { globals: { process: 'readonly' } },
  },
);
