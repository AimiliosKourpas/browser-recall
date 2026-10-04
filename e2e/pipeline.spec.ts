// M3: consent gate, history import, live sync, deletion mirroring, restart behaviour and schedules — real extension, real Chromium
// history (pages visited through the fixture server), real OPFS engine.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';
import { expect, openExtensionPage, test } from './fixtures';
import { engine, launchExtension, status, toolPage, urls } from './support/pipeline';

const visit = async (context: BrowserContext, origin: string, name: string) => {
  const page = await context.newPage();
  await page.goto(`${origin}/f/${name}.html`);
  await page.waitForTimeout(250);
  await page.close();
};
const gizmo = (origin: string, n: string) => `${origin}/f/gizmo-${n}.html`;

test('consent gate → import of existing history → live sync → mirrored deletion (saved pages survive) → no egress', async ({ context, extensionId, server }) => {
  test.setTimeout(120_000);
  const seen: string[] = [];
  context.on('request', (r) => seen.push(r.url()));

  await visit(context, server.origin, 'gizmo-alpha');
  await visit(context, server.origin, 'gizmo-beta');
  const tool = await toolPage(context, extensionId);

  // BEFORE consent: history exists in Chrome, but nothing is read, imported or scheduled
  await tool.waitForTimeout(1500);
  expect(await status(tool)).toMatchObject({ consent: 'none', importStatus: 'idle', processed: 0 });
  expect((await engine(tool, { method: 'stats' })).pages).toBe(0);
  expect(await tool.evaluate(() => chrome.alarms.getAll().then((a) => a.length))).toBe(0);

  // the onboarding consent screen: explicit button, no automatic import
  const onboarding = await openExtensionPage(context, extensionId, 'onboarding.html');
  await expect(onboarding.getByRole('button', { name: 'Allow and import history' })).toBeVisible();
  await expect(onboarding.getByText(/makes no network requests/)).toBeVisible();
  await onboarding.getByRole('button', { name: 'Allow and import history' }).click();
  await expect(onboarding.getByText(/Import complete/)).toBeVisible({ timeout: 30_000 });
  await onboarding.close(); // the import never needed the page

  // existing history is now searchable through the real engine; extension pages were not indexed
  expect((await urls(tool, 'gizmo')).sort()).toEqual([gizmo(server.origin, 'alpha'), gizmo(server.origin, 'beta')]);
  expect((await urls(tool, 'search')).filter((u) => u.startsWith('chrome-extension'))).toEqual([]);
  expect(await status(tool)).toMatchObject({ consent: 'granted', importStatus: 'complete' });

  // live sync: a NEW visit reaches the index without any user action
  await visit(context, server.origin, 'gizmo-gamma');
  await expect.poll(() => urls(tool, 'gamma'), { timeout: 15_000 }).toEqual([gizmo(server.origin, 'gamma')]);

  // mirrored deletion of a recent entry
  await tool.evaluate((u) => chrome.history.deleteUrl({ url: u }), gizmo(server.origin, 'gamma'));
  await expect.poll(() => urls(tool, 'gamma'), { timeout: 15_000 }).toEqual([]);

  // saved pages survive both a single deletion and delete-all
  await engine(tool, { method: 'savePage', params: { url: gizmo(server.origin, 'alpha'), title: 'Gizmo alpha', body: 'precious saved notes', savedAt: Date.now() } });
  await tool.evaluate((u) => chrome.history.deleteUrl({ url: u }), gizmo(server.origin, 'alpha'));
  await expect.poll(async () => (await engine(tool, { method: 'search', params: { query: 'alpha', now: Date.now() } })).results[0]?.flags.history).toBe(false);
  expect(await urls(tool, 'precious')).toEqual([gizmo(server.origin, 'alpha')]);
  await tool.evaluate(() => chrome.history.deleteAll());
  await expect.poll(() => urls(tool, 'beta'), { timeout: 15_000 }).toEqual([]);
  expect(await urls(tool, 'precious is:saved')).toEqual([gizmo(server.origin, 'alpha')]);
  expect((await engine(tool, { method: 'integrityCheck' })).ok).toBe(true);

  // privacy: apart from our own fixture-page navigations, no request left the browser
  expect(seen.filter((u) => !/^(chrome-extension|chrome|data|blob|about):/.test(u) && !u.startsWith(server.origin))).toEqual([]);
  expect(server.requests.filter((u) => !u.startsWith('/f/gizmo-') && u !== '/favicon.ico')).toEqual([]);
});

test('consent and import survive a full browser restart; live sync keeps working afterwards', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m3-restart-'));
  const { startFixtureServer } = await import('./fixtures-server');
  const server = await startFixtureServer();
  try {
    const a = await launchExtension(dir);
    await visit(a.context, server.origin, 'gizmo-alpha');
    let tool = await toolPage(a.context, a.extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    await a.context.close();

    const b = await launchExtension(dir);
    tool = await toolPage(b.context, b.extensionId);
    expect(await status(tool)).toMatchObject({ consent: 'granted', importStatus: 'complete' });
    expect(await urls(tool, 'alpha')).toEqual([gizmo(server.origin, 'alpha')]); // OPFS data persisted too
    await visit(b.context, server.origin, 'gizmo-beta');
    await expect.poll(() => urls(tool, 'beta'), { timeout: 15_000 }).toEqual([gizmo(server.origin, 'beta')]);
    // no new onboarding tab: the user is not asked again
    expect(b.context.pages().filter((p) => p.url().endsWith('/onboarding.html'))).toHaveLength(0);
    await b.context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('declining consent keeps the extension inert (nothing imported after a restart either)', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m3-decline-'));
  const { startFixtureServer } = await import('./fixtures-server');
  const server = await startFixtureServer();
  try {
    const a = await launchExtension(dir);
    await visit(a.context, server.origin, 'gizmo-alpha');
    const onboarding = await openExtensionPage(a.context, a.extensionId, 'onboarding.html');
    await onboarding.getByRole('button', { name: 'No thanks' }).click();
    await expect(onboarding.getByText(/will stay inactive/)).toBeVisible();
    await a.context.close();
    const b = await launchExtension(dir);
    const tool = await toolPage(b.context, b.extensionId);
    await visit(b.context, server.origin, 'gizmo-beta');
    await tool.waitForTimeout(2000);
    expect(await status(tool)).toMatchObject({ consent: 'none', importStatus: 'idle' });
    expect((await engine(tool, { method: 'stats' })).pages).toBe(0);
    await b.context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('schedules: daily alarms exist exactly once, survive a service-worker restart, and the maintenance alarm really runs', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const tool = await toolPage(context, extensionId);
  await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
  await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
  const alarms = () => tool.evaluate(() => chrome.alarms.getAll().then((all) => all.map((a) => `${a.name}:${a.periodInMinutes}`).sort()));
  expect(await alarms()).toEqual(['br-maintenance:1440', 'br-reconcile:1440']); // watchdog only exists while an import runs

  const cdp = await context.newCDPSession(tool);
  const versions: { versionId: string }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.length).toBeGreaterThan(0);
  for (const v of versions) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  await status(tool); // wakes the service worker
  expect(await alarms()).toEqual(['br-maintenance:1440', 'br-reconcile:1440']); // no duplicates, nothing lost

  expect((await status(tool)).lastMaintenanceAt).toBeNull();
  await tool.evaluate(() => chrome.alarms.create('br-maintenance', { when: Date.now() + 500 })); // fire it now (replaces the periodic one)
  await expect.poll(async () => (await status(tool)).lastMaintenanceAt, { timeout: 20_000 }).not.toBeNull();
  await expect.poll(alarms, { timeout: 10_000 }).toEqual(['br-maintenance:1440', 'br-reconcile:1440']); // the handler restored the periodic alarm
  expect((await status(tool)).lastIntegrity).toMatchObject({ ok: true });
});

test('large history: bounded resumable import through the production pipeline, killed twice, then Chrome\'s own 90-day expiry must not erase the archive', async () => {
  test.setTimeout(420_000);
  const BULK = 50_000;
  const ANCIENT = 70;
  const dir = mkdtempSync(join(tmpdir(), 'br-m3-large-'));
  try {
    // create the profile (History schema), close, seed rows straight into the History database, relaunch with the extension
    const bootstrap = await chromium.launchPersistentContext(dir, { ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: false, args: ['--no-sandbox'] });
    await new Promise((r) => setTimeout(r, 3000));
    await bootstrap.close();
    const { seedHistory } = await import('./support/pipeline');
    seedHistory(dir, BULK, ANCIENT);

    const { context, extensionId } = await launchExtension(dir);
    const tool = await toolPage(context, extensionId);
    const started = Date.now();
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));

    // kill the service worker twice mid-import; any later message wakes it and the import resumes from its checkpoint
    const cdp = await context.newCDPSession(tool);
    const versions: { versionId: string }[] = [];
    cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
    await cdp.send('ServiceWorker.enable');
    await expect.poll(() => versions.length).toBeGreaterThan(0);
    let killedWhileRunning = 0;
    for (let kill = 0; kill < 2; kill++) {
      await expect.poll(async () => (await status(tool)).windows, { timeout: 60_000 }).toBeGreaterThan(kill * 2);
      if ((await status(tool)).importStatus === 'complete') break;
      for (const v of versions) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId }).catch(() => undefined);
      killedWhileRunning++;
    }
    expect(killedWhileRunning, 'the import must really have been interrupted at least once').toBeGreaterThan(0);
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 240_000, intervals: [1000] }).toBe('complete');
    const seconds = (Date.now() - started) / 1000;
    const st = await status(tool);
    const stats = await engine(tool, { method: 'stats' });
    console.log(JSON.stringify({ rows: BULK + ANCIENT, importSeconds: Math.round(seconds), rowsPerSec: Math.round((BULK + ANCIENT) / seconds), killedWhileRunning, windows: st.windows, processed: st.processed, dbMB: +(stats.dbBytes / 1e6).toFixed(1) }));
    expect(stats.pages).toBe(BULK + ANCIENT); // everything exactly once, despite the interruptions
    expect(await urls(tool, 'topic42 site:42.bulk.example')).not.toEqual([]);
    expect(await urls(tool, 'ancient')).toHaveLength(50); // default result limit; all 70 are indexed (checked after expiry below)

    // Chrome's expiry job deletes the 100-day-old rows from ITS history ~1-2 minutes after start (M0 S4) and fires onVisitRemoved
    await expect
      .poll(() => tool.evaluate(() => chrome.history.search({ text: 'ancient', startTime: 0, maxResults: 1000 }).then((r) => r.filter((x) => x.url?.includes('ancient-')).length)), { timeout: 300_000, intervals: [5000] })
      .toBe(0);
    await tool.waitForTimeout(3000);
    const kept = await engine(tool, { method: 'search', params: { query: 'ancient memory', now: Date.now(), limit: 200 } });
    expect(kept.results.filter((r) => r.url.includes('ancient-'))).toHaveLength(ANCIENT); // the archive outlived Chrome's 90 days
    expect((await engine(tool, { method: 'integrityCheck' })).ok).toBe(true);
    await context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
