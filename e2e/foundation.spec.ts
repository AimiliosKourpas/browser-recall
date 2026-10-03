import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect, openExtensionPage } from './fixtures';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

test('loads with no manifest errors or install warnings', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  // chrome.developerPrivate exists only on chrome://extensions and has no published typings: evaluate as a string.
  const info = await page.evaluate<{ id: string; name: string; state: string; manifestErrors: number; installWarnings: number }[]>(
    `chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }).then((list) =>
       list.map((e) => ({ id: e.id, name: e.name, state: e.state, manifestErrors: e.manifestErrors.length, installWarnings: e.installWarnings.length })))`,
  );
  const ours = info.find((e) => e.id === extensionId);
  expect(ours).toMatchObject({ name: 'Browser Recall', state: 'ENABLED', manifestErrors: 0, installWarnings: 0 });
});

test('opens the onboarding page on install', async ({ context, extensionId }) => {
  await expect.poll(() => context.pages().some((p) => p.url() === `chrome-extension://${extensionId}/onboarding.html`), { timeout: 10_000 }).toBe(true);
});

test('service worker creates the offscreen document and reaches the engine worker', async ({ context, extensionId }) => {
  const page = await openExtensionPage(context, extensionId, 'search.html');
  await expect(page.getByRole('status')).toHaveText('Local search engine ready.');
  const contexts = await page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length));
  expect(contexts).toBe(1);
  const raw = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/ensure-engine' }));
  expect(raw).toMatchObject({ ok: true, data: { protocol: 1 } });
});

test('engine survives a service worker restart (stateless SW)', async ({ context, extensionId }) => {
  const page = await openExtensionPage(context, extensionId, 'search.html');
  await expect(page.getByRole('status')).toHaveText('Local search engine ready.');
  const first = (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/ensure-engine' }))) as { data: { instanceId: string } };
  const cdp = await context.newCDPSession(page);
  const versions: { versionId: string }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.length).toBeGreaterThan(0);
  for (const v of versions) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  const second = (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/ensure-engine' }))) as { ok: boolean; data: { instanceId: string } };
  expect(second.ok).toBe(true);
  expect(second.data.instanceId).toBe(first.data.instanceId); // same offscreen/worker: it outlived the SW
});

test('does not touch ordinary web pages (no content scripts in M1)', async ({ context, server }) => {
  const page = await context.newPage();
  await page.goto(`${server.origin}/f/article.html`);
  expect(await page.title()).toBe('Fixture article');
  expect(await page.evaluate("document.querySelectorAll('iframe').length + (typeof window.__brOverlay)")).toBe('0undefined');
});

test('locked CSP: no outbound request leaves any extension page', async ({ context, extensionId, server }) => {
  const page = await openExtensionPage(context, extensionId, 'search.html');
  const probe = (kind: string) => `${server.origin}/probe-${kind}`;
  // Evaluated as strings on purpose: the lint rules ban fetch/sendBeacon in source; this probes what the CSP enforces.
  const fetched = await page.evaluate(`fetch(${JSON.stringify(probe('fetch'))}, { mode: 'no-cors' }).then(() => 'sent', () => 'blocked')`);
  await page.evaluate(`navigator.sendBeacon(${JSON.stringify(probe('beacon'))}, 'x')`);
  await page.evaluate(`new Promise((r) => { const i = new Image(); i.onload = i.onerror = () => r(0); i.src = ${JSON.stringify(probe('img'))}; })`);
  await page.waitForTimeout(500);
  expect(fetched).toBe('blocked');
  expect(server.requests.filter((u) => u.startsWith('/probe-'))).toEqual([]);
});

for (const path of ['search.html', 'onboarding.html']) {
  test(`axe: no serious or critical violations on ${path}`, async ({ context, extensionId }) => {
    const page = await openExtensionPage(context, extensionId, path);
    await page.waitForSelector('main');
    await page.evaluate(axeSource);
    const results = await page.evaluate<{ violations: { id: string; impact: string }[] }>('axe.run()');
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
}
