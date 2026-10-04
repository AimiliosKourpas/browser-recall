// M2: the production engine in real Chromium — persistence across service-worker restart, offscreen recreation and a full
// browser restart, plus the privacy regression (no egress) while the engine is busy.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import type { EngineCall, EngineResults } from '../src/engine/contract';
import { EXTENSION_DIR, expect, openExtensionPage, test } from './fixtures';

type Ok<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/** Calls the engine exactly as UI code does: a validated `sw/engine` message to the service worker. */
async function call<C extends EngineCall>(page: Page, request: C): Promise<EngineResults[C['method']]> {
  const response = await page.evaluate((c) => chrome.runtime.sendMessage({ type: 'sw/engine', call: c }), request as never);
  const r = response as Ok<EngineResults[C['method']]>;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data;
}

const NOW = Date.UTC(2026, 9, 3, 12);
const search = (page: Page, query: string) => call(page, { method: 'search', params: { query, now: NOW } }).then((r) => r.results.map((x) => x.url));

async function seed(page: Page) {
  await call(page, {
    method: 'upsertHistory',
    params: {
      rows: [
        { url: 'https://rust.example/book', title: 'The Rust Programming Language', lastVisitTime: NOW - 86_400_000, visitCount: 3 },
        { url: 'https://blog.example/greek', title: 'Βιβλίο συνταγών', lastVisitTime: NOW - 2 * 86_400_000 },
        { url: 'chrome://settings', title: 'Settings', lastVisitTime: NOW },
      ],
    },
  });
  await call(page, { method: 'upsertContent', params: { url: 'https://rust.example/book', body: 'Ownership and borrowing are the core ideas of the language.', indexedAt: NOW } });
  await call(page, { method: 'savePage', params: { url: 'https://blog.example/greek', title: 'Βιβλίο συνταγών', body: 'Το καλύτερο βιβλίο για ΖΑΧΑΡΩΤΑ γλυκά', savedAt: NOW } });
  await call(page, { method: 'addSnippet', params: { url: 'https://rust.example/book', pageTitle: 'The Rust Programming Language', text: 'ownership is rust’s most unique feature', createdAt: NOW } });
}

async function expectSeeded(page: Page) {
  expect(await search(page, 'borrowing')).toEqual(['https://rust.example/book']);
  expect(await search(page, 'ζαχαρωτα')).toEqual(['https://blog.example/greek']); // Greek folding after restart
  expect(await search(page, 'βιβλιο is:saved')).toEqual(['https://blog.example/greek']);
  const snippets = (await call(page, { method: 'search', params: { query: 'unique feature is:snippet', now: NOW } })).results;
  expect(snippets.map((r) => r.kind)).toEqual(['snippet']);
  const stats = await call(page, { method: 'stats' });
  expect(stats).toMatchObject({ schemaVersion: 1, pages: 2, saved: 1, snippets: 1, autoVacuum: 'incremental' });
  expect((await call(page, { method: 'integrityCheck' })).ok).toBe(true);
}

test('engine: write → search → service-worker restart → offscreen recreation → still searchable (same OPFS database)', async ({ context, extensionId }) => {
  const page = await openExtensionPage(context, extensionId, 'search.html');
  test.info().annotations.push({ type: 'browser', description: await page.evaluate(() => navigator.userAgent) }); // shows which Chrome ran (CHROMIUM_PATH compat job)
  await expect(page.locator('[data-engine-state="ready"]')).toBeVisible();
  await seed(page);
  await expectSeeded(page);
  const first = await call(page, { method: 'ping' });

  // 1) terminate the service worker (stateless router): the engine and its data are unaffected
  const cdp = await context.newCDPSession(page);
  const versions: { versionId: string }[] = [];
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => versions.push(...e.versions));
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => versions.length).toBeGreaterThan(0);
  for (const v of versions) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  await expectSeeded(page);
  expect((await call(page, { method: 'ping' })).instanceId).toBe(first.instanceId);

  // 2) destroy the offscreen document (and with it the engine worker and its OPFS handles) and let the SW recreate it
  const targets = (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.url.endsWith('/offscreen.html'));
  expect(targets).toHaveLength(1);
  await cdp.send('Target.closeTarget', { targetId: (targets[0] as { targetId: string }).targetId });
  await expect.poll(() => page.evaluate(() => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length))).toBe(0);
  await expectSeeded(page); // reopens the same database, tolerating delayed OPFS handle release (A3)
  expect((await call(page, { method: 'ping' })).instanceId).not.toBe(first.instanceId); // a genuinely new engine instance
});

test('engine: data survives a full browser restart (same profile)', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'br-persist-'));
  const launch = async (): Promise<{ context: BrowserContext; page: Page }> => {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--no-sandbox'],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const page = await openExtensionPage(context, new URL(worker.url()).host, 'search.html');
    await expect(page.locator('[data-engine-state="ready"]')).toBeVisible();
    return { context, page };
  };
  try {
    const a = await launch();
    await seed(a.page);
    await expectSeeded(a.page);
    await a.context.close();
    const b = await launch();
    await expectSeeded(b.page);
    await b.context.close();
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

test('engine: validation gate and typed errors', async ({ context, extensionId }) => {
  const page = await openExtensionPage(context, extensionId, 'search.html');
  await expect(page.locator('[data-engine-state="ready"]')).toBeVisible();
  // malformed calls never reach the engine: the service worker ignores them (no response → the page sees undefined)
  const bad = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/engine', call: { method: 'search', params: { query: 42 } } }).then((r) => r ?? 'ignored', () => 'ignored'));
  expect(bad).toBe('ignored');
  const rawSql = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/engine', call: { method: 'exec', params: { sql: 'DROP TABLE pages' } } }).then((r) => r ?? 'ignored', () => 'ignored'));
  expect(rawSql).toBe('ignored');
  expect((await call(page, { method: 'stats' })).pages).toBeGreaterThanOrEqual(0);
});

test('privacy regression: a busy engine makes no network request', async ({ context, extensionId, server }) => {
  // every request Playwright can observe in this context (pages and service workers); the full-scenario recorder over all
  // contexts, including the offscreen document, is an M8 deliverable
  const seen: string[] = [];
  context.on('request', (r) => seen.push(r.url()));
  const page = await openExtensionPage(context, extensionId, 'search.html');
  await expect(page.locator('[data-engine-state="ready"]')).toBeVisible();
  await seed(page);
  await expectSeeded(page);
  await call(page, { method: 'maintenance', params: { ftsMerge: true } });
  await page.waitForTimeout(300);
  expect(server.requests).toEqual([]);
  expect(seen.filter((u) => !/^(chrome-extension|chrome|data|blob|about):/.test(u))).toEqual([]);
});
