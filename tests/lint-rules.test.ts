import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Each privacy/security ban must actually fire. Lint runs the project's real config over in-memory snippets.
const eslint = new ESLint({ cwd: process.cwd() });
async function messages(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

const banned: [string, string][] = [
  ['fetch', "await fetch('https://example.com');"],
  ['XMLHttpRequest', 'const x = new XMLHttpRequest();'],
  ['WebSocket', "const s = new WebSocket('wss://example.com');"],
  ['EventSource', "const s = new EventSource('/x');"],
  ['sendBeacon', "navigator.sendBeacon('/x', 'y');"],
  ['globalThis.fetch', "await globalThis.fetch('/x');"],
  ['self.fetch', "await self.fetch('/x');"],
  ['importScripts', "importScripts('https://cdn.example/x.js');"],
  ['eval', "eval('1+1');"],
  ['new Function', "new Function('return 1');"],
  ['setTimeout(string)', "setTimeout('alert(1)', 10);"],
  ['innerHTML', "document.body.innerHTML = '<b>x</b>';"],
  ['outerHTML', "el.outerHTML = '<b>x</b>';"],
  ['insertAdjacentHTML', "el.insertAdjacentHTML('beforeend', x);"],
  ['document.write', "document.write('x');"],
  ['dangerouslySetInnerHTML', 'export const C = () => <div dangerouslySetInnerHTML={{ __html: x }} />;'],
  ['dynamic import (computed)', 'const m = await import(name);'],
  ['dynamic import (URL)', "const m = await import('https://cdn.example/x.js');"],
  ['remote Worker', "new Worker('https://cdn.example/w.js');"],
  // eslint-disable-next-line no-script-url -- the snippet under test is data, not executed
  ['javascript: URL', "const u = 'javascript:alert(1)';"],
];

describe('privacy/security lint bans', () => {
  for (const [name, code] of banned) {
    const file = code.includes('<div') ? 'src/ui/x.tsx' : 'src/shared/x.ts';
    it(`bans ${name} in src`, async () => {
      expect((await messages(code, file)).length).toBeGreaterThan(0);
    });
  }
  it('also bans network APIs in test files and e2e files', async () => {
    expect((await messages("await fetch('/x');", 'tests/some.test.ts')).length).toBeGreaterThan(0);
    expect((await messages("await fetch('/x');", 'e2e/some.spec.ts')).length).toBeGreaterThan(0);
  });
  it('bans chrome.* inside the pure engine core', async () => {
    expect((await messages('const id = chrome.runtime.id;', 'src/engine/x.ts')).join()).toMatch(/chrome/);
    expect(await messages('export const id = chrome.runtime.id;', 'src/background/x.ts')).toEqual([]);
  });
  it('allows ordinary code (no false positives)', async () => {
    const ok = "export const f = (el: HTMLElement) => { el.textContent = 'hi'; const w = new Worker(chrome.runtime.getURL('/engine-worker.js')); return w; };";
    expect(await messages(ok, 'src/ui/ok.ts')).toEqual([]);
    expect(await messages("export const m = await import('./local');", 'src/ui/ok2.ts')).toEqual([]);
  });
});
