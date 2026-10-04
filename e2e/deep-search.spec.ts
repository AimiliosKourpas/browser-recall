// M6: Deep Search capture on the real extension. The e2e build holds a REQUIRED host permission for fixture.test (Playwright cannot
// accept the optional-permission prompt); the production build, exercised in the denial test, holds none.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CDPSession } from '@playwright/test';
import { expect, openExtensionPage, test } from './fixtures';
import { startFixtureServer } from './fixtures-server';
import { engine, fixtureOrigin, launchExtension, send, status, toolPage, urls } from './support/pipeline';


test('Deep Search: off by default → enable → capture body text → duplicate/limits → survives SW restart → exclude → disable → History + Saved keep working', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m6-'));
  const server = await startFixtureServer();
  const origin = fixtureOrigin(server);
  try {
    const { context, extensionId } = await launchExtension(dir, { e2e: true });
    const tool = await toolPage(context, extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    const deep = async () => (await send<{ enabled: boolean }>(tool, { type: 'sw/deep-status' })) as { ok: true; data: { enabled: boolean; excluded: string[] } };

    // Deep Search is off: the page is visited (history knows title + URL) but its body is not captured
    expect((await deep()).data.enabled).toBe(false);
    const offPage = await context.newPage();
    await offPage.goto(`${origin}/f/deep-body.html`);
    await expect.poll(async () => (await engine(tool, { method: 'stats' })).withHistory, { timeout: 15_000 }).toBeGreaterThan(0);
    await offPage.waitForTimeout(1500);
    expect(await urls(tool, 'nebulous-pomelo-ledger')).toEqual([]);
    expect((await engine(tool, { method: 'stats' })).withContent).toBe(0);

    // enable → visit → capture → search body text
    expect(await send(tool, { type: 'sw/deep-enable' })).toMatchObject({ ok: true, data: { enabled: true } });
    const page = await context.newPage();
    await page.goto(`${origin}/f/deep-body.html`);
    await expect.poll(async () => urls(tool, 'nebulous pomelo ledger'), { timeout: 20_000 }).toEqual([`${origin}/f/deep-body.html`]);
    const hit = (await engine(tool, { method: 'search', params: { query: 'nebulous pomelo', now: Date.now() } })).results[0];
    expect(hit).toMatchObject({ source: 'deep', title: 'Orchard report', flags: { history: true, content: true, saved: false } });
    expect(await urls(tool, 'zzfooter')).toEqual([]); // boilerplate not captured
    const pagesBefore = (await engine(tool, { method: 'stats' })).pages;

    // duplicate visit: one page, same text, still found
    await page.reload();
    await page.waitForTimeout(1500);
    expect((await engine(tool, { method: 'stats' })).pages).toBe(pagesBefore);
    expect(await urls(tool, 'nebulous')).toHaveLength(1);

    // skipped pages: password form, too little text → history only, never body text
    for (const f of ['deep-login', 'deep-tiny']) {
      const p = await context.newPage();
      await p.goto(`${origin}/f/${f}.html`);
      await p.waitForTimeout(1500);
    }
    expect(await urls(tool, 'hidden-wombat-token')).toEqual([]);
    expect(await urls(tool, 'tinyquokka')).toEqual([]);
    expect((await engine(tool, { method: 'stats' })).withContent).toBe(1);

    // the search UI finds it by body text and labels it
    const search = await openExtensionPage(context, extensionId, 'search.html');
    await expect(search.locator('[data-engine-state="ready"]')).toBeVisible();
    await search.getByRole('combobox').fill('nebulous pomelo');
    await expect(search.getByRole('option')).toHaveCount(1);

    // restart the service worker: state and index survive; capture keeps working afterwards
    const cdp: CDPSession = await context.newCDPSession(tool);
    const versions: { versionId: string }[] = [];
    cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versions.length).toBeGreaterThan(0);
    for (const v of versions) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
    expect((await deep()).data.enabled).toBe(true);
    expect(await urls(tool, 'nebulous pomelo')).toHaveLength(1);

    // settings page: exclusion removes that site's Deep text and prevents recapture
    const settings = await openExtensionPage(context, extensionId, 'settings.html');
    await expect(settings.locator('[data-deep-state="on"]')).toBeVisible();
    await settings.getByLabel(/Site to exclude/).fill('fixture.test');
    await settings.locator('#exclude-add').click();
    await expect(settings.locator('li', { hasText: 'fixture.test' })).toBeVisible();
    await expect.poll(async () => urls(tool, 'nebulous pomelo')).toEqual([]);
    expect(await urls(tool, 'orchard')).toHaveLength(1); // the History record stays
    await page.reload();
    await page.waitForTimeout(1500);
    expect(await urls(tool, 'nebulous pomelo')).toEqual([]);
    await settings.getByRole('button', { name: 'Stop excluding' }).click();
    await expect.poll(async () => (await deep()).data.excluded).toEqual([]);

    // save the page (Saved), turn Deep Search off: Saved + History still work, nothing new is captured
    await page.reload();
    await expect.poll(async () => urls(tool, 'nebulous pomelo')).toHaveLength(1);
    expect(await send(tool, { type: 'sw/deep-disable' })).toMatchObject({ ok: true, data: { enabled: false } });
    await engine(tool, { method: 'savePage', params: { url: `${origin}/f/saved-thing.html`, title: 'Saved thing', body: 'persimmon custard recipe', savedAt: Date.now() } });
    const later = await context.newPage();
    await later.goto(`${origin}/f/article.html`);
    await later.waitForTimeout(1500);
    expect(await urls(tool, 'persimmon custard')).toEqual([`${origin}/f/saved-thing.html`]);
    expect(await urls(tool, 'orchard')).toHaveLength(1);
    expect((await engine(tool, { method: 'integrityCheck' })).ok).toBe(true);
    expect((await engine(tool, { method: 'stats' })).withContent).toBe(2); // the earlier capture + the saved page; nothing new while off

    // "Delete all Deep Search text" keeps the History row and the saved page
    await send(tool, { type: 'sw/deep-clear' });
    expect(await urls(tool, 'nebulous pomelo')).toEqual([]);
    expect(await urls(tool, 'orchard')).toHaveLength(1);
    expect(await urls(tool, 'persimmon custard')).toHaveLength(1);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('production build: no host access is held; Deep Search cannot be turned on without it and History + Saved stay fully functional', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m6p-'));
  try {
    const { context, extensionId } = await launchExtension(dir);
    const tool = await toolPage(context, extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    const held = await tool.evaluate(() => chrome.permissions.getAll());
    expect(held.origins ?? []).toEqual([]);
    expect(await send(tool, { type: 'sw/deep-enable' })).toMatchObject({ ok: false, error: { message: 'permission-required' } });
    expect(await send(tool, { type: 'sw/deep-status' })).toMatchObject({ ok: true, data: { enabled: false, permission: false } });
    await engine(tool, { method: 'savePage', params: { url: 'https://saved.example.com/a', title: 'Saved A', body: 'loquat chutney', savedAt: Date.now() } });
    expect(await urls(tool, 'loquat chutney')).toEqual(['https://saved.example.com/a']);
    const settings = await openExtensionPage(context, extensionId, 'settings.html');
    await expect(settings.locator('[data-deep-state="off"]')).toBeVisible();
    await expect(settings.locator('#deep-enable')).toBeEnabled();
    await context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
