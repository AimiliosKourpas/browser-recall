// Release regression (real Chrome 153 finding): the popup search window must really LOAD (not "blocked by Chrome"), the extension must
// log no console errors/warnings on any of its contexts, and web pages must not be able to embed the extension's pages.
// Popup windows are not exposed as Playwright pages, so they are verified through the browser's own target list (title + URL).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, openExtensionPage, test } from './fixtures';
import { startFixtureServer } from './fixtures-server';
import { cdpTargets, freePort, launchExtension, send } from './support/pipeline';

const searchTargets = async (port: number) => (await cdpTargets(port)).filter((t) => t.type === 'page' && /\/search\.html/.test(t.url));
const blocked = (targets: { url: string; title: string }[]) => targets.filter((t) => t.url.startsWith('chrome-error:') || t.title.startsWith('chrome-extension://'));

test('onboarding → "Open search" and sw/open-search create a popup that actually loads search.html (not blocked by Chrome)', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-surf-'));
  const port = await freePort();
  try {
    const { context } = await launchExtension(dir, { debugPort: port });
    const onboarding = context.pages().find((p) => p.url().includes('onboarding.html')) ?? (await context.waitForEvent('page'));
    await onboarding.getByRole('button', { name: 'Allow and import history' }).click();
    await expect(onboarding.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 });
    expect(await searchTargets(port)).toHaveLength(0);
    await onboarding.getByRole('button', { name: 'Open search' }).click(); // the exact route that failed in real Chrome
    await expect.poll(async () => (await searchTargets(port)).filter((t) => t.title === 'Browser Recall').length, { timeout: 15_000 }).toBe(1);
    expect(blocked(await searchTargets(port))).toEqual([]);
    expect((await cdpTargets(port)).filter((t) => t.url.startsWith('chrome-error:'))).toEqual([]);
    // the same through the message used by the toolbar/shortcut fallback
    const before = (await searchTargets(port)).length;
    await send(onboarding, { type: 'sw/open-search' });
    await expect.poll(async () => (await searchTargets(port)).filter((t) => t.title === 'Browser Recall').length, { timeout: 15_000 }).toBe(before + 1);
    expect(blocked(await searchTargets(port))).toEqual([]);
    await context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the engine worker initialises without any console error or warning (they are listed on chrome://extensions → Errors)', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-logs-'));
  try {
    const { context, extensionId } = await launchExtension(dir);
    // onboarding never touches the engine, so this worker is the first thing to initialise sqlite-wasm in this profile
    const page = context.pages().find((p) => p.url().includes('onboarding.html')) ?? (await openExtensionPage(context, extensionId, 'onboarding.html'));
    const messages: string[] = [];
    page.on('console', (m) => ['error', 'warning'].includes(m.type()) && messages.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    const reply = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const worker = new Worker(chrome.runtime.getURL('/engine-worker.js')); // the exact bundle the offscreen document starts
          worker.onmessage = (e: MessageEvent<{ id?: number; ok?: boolean }>) => {
            if (e.data.id === 1) {
              worker.terminate();
              resolve(JSON.stringify(e.data).slice(0, 80));
            }
          };
          worker.postMessage({ id: 1, call: { method: 'stats' } }); // first real call: loads sqlite, installs the VFS, opens the database
        }),
    );
    expect(reply).toContain('"ok":true');
    await page.waitForTimeout(1500);
    expect(messages).toEqual([]);
    await context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a web page cannot embed the extension: static-URL frames of overlay.html and search.html are blocked', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-embed-'));
  const server = await startFixtureServer();
  try {
    const { context, extensionId } = await launchExtension(dir);
    const page = await context.newPage();
    await page.goto(`${server.origin}/f/overlay-plain.html`);
    await page.evaluate((id) => {
      for (const name of ['overlay', 'search']) {
        const f = document.createElement('iframe');
        f.src = `chrome-extension://${id}/${name}.html`;
        document.body.append(f);
      }
    }, extensionId);
    await page.waitForTimeout(2000);
    const loaded = page.frames().filter((f) => f.url().startsWith('chrome-extension://')).map((f) => f.url());
    // search.html is not web-accessible at all: blocked everywhere. overlay.html is the one web-accessible page; its static URL is only
    // blocked from web pages where `use_dynamic_url` is enforced (Chrome >= 130; Chrome 116-129 ignore the key: documented in ADR-003).
    expect(loaded.filter((u) => u.includes('/search.html'))).toEqual([]);
    const major = Number.parseInt(context.browser()?.version() ?? '0', 10);
    if (major >= 130) expect(loaded).toEqual([]);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
