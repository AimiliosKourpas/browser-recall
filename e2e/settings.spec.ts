// M8: settings, data controls, ledger, export/import, accessibility and a no-egress recorder over a full scenario.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, openExtensionPage, test } from './fixtures';
import { startFixtureServer } from './fixtures-server';
import { engine, fixtureOrigin, launchExtension, send, status, toolPage, urls } from './support/pipeline';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const serious = async (page: Page) => {
  await page.evaluate(axeSource);
  const r = await page.evaluate<{ violations: { id: string; impact: string; nodes: unknown[] }[] }>('axe.run()');
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} (${v.impact})`);
};

test('settings: status, pause/resume, persisted preferences, ledger, delete controls, export/import, shortcuts, diagnostics, a11y, no egress', async () => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m8-'));
  const server = await startFixtureServer();
  const origin = fixtureOrigin(server);
  const allowed = (u: string) => u.startsWith('chrome-extension://') || u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('chrome://') || u === 'about:blank';
  const outside: string[] = [];
  let seen = 0;
  try {
    const { context, extensionId } = await launchExtension(dir, { e2e: true });
    context.on('request', (r) => { seen++; if (!allowed(r.url())) outside.push(r.url()); });

    // onboarding before consent: all the disclosures are present and accessible
    const onboarding = await openExtensionPage(context, extensionId, 'onboarding.html');
    await expect(onboarding.getByRole('heading', { name: 'Everything stays on this device' })).toBeVisible();
    await expect(onboarding.getByRole('heading', { name: 'Deep Search is separate and optional' })).toBeVisible();
    await expect(onboarding.getByRole('heading', { name: 'How to use it' })).toBeVisible();
    await expect(onboarding.getByText(/Remember this page/).first()).toBeVisible();
    await expect(onboarding.getByText(/does not encrypt the index/)).toBeVisible();
    expect(await serious(onboarding)).toEqual([]);

    for (const n of ['alpha', 'beta', 'gamma']) {
      const p = await context.newPage();
      await p.goto(`${origin}/f/gizmo-${n}.html`);
      await p.waitForTimeout(250);
      await p.close();
    }
    const tool = await toolPage(context, extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    await engine(tool, { method: 'savePage', params: { url: 'https://keep.example.com/recipe', title: 'Keeper recipe', body: 'saffron risotto notes', savedAt: Date.now() } });
    await engine(tool, { method: 'addSnippet', params: { url: 'https://keep.example.com/recipe', pageTitle: 'Keeper recipe', text: 'stir slowly', createdAt: Date.now() } });
    await engine(tool, { method: 'upsertContent', params: { url: 'https://deep.example.org/a', title: 'Deep A', body: 'orchard ledger text', indexedAt: Date.now() } });

    const settings = await openExtensionPage(context, extensionId, 'settings.html');
    await expect(settings.locator('#index-summary')).toContainText('pages');
    await expect(settings.locator('#index-summary')).toContainText('1 remembered');
    expect(await serious(settings)).toEqual([]);

    // pause / resume: state, toolbar badge, and live indexing
    await settings.locator('#pause-toggle').click();
    await expect(settings.locator('#pause-toggle')).toHaveText('Resume indexing');
    expect((await status(tool)).paused).toBe(true);
    expect(await tool.evaluate(() => chrome.action.getBadgeText({}))).toBe('II');
    await settings.locator('#pause-toggle').click();
    await expect(settings.locator('#pause-toggle')).toHaveText('Pause indexing');
    expect(await tool.evaluate(() => chrome.action.getBadgeText({}))).toBe('');

    // preferences persist and reach the stored settings
    await settings.locator('#retention').selectOption('forever');
    await settings.locator('#cap').selectOption('500');
    await settings.locator('#mirror').uncheck();
    await expect.poll(async () => (await send<{ capMb: number }>(tool, { type: 'sw/settings-get' }) as { data: object }).data).toEqual({ paused: false, retentionMonths: null, capMb: 500, mirrorDeletion: false });
    await settings.reload();
    await expect(settings.locator('#retention')).toHaveValue('forever');
    await expect(settings.locator('#cap')).toHaveValue('500');
    await expect(settings.locator('#mirror')).not.toBeChecked();
    await settings.locator('#mirror').check();
    await settings.locator('#retention').selectOption('12');
    await settings.locator('#cap').selectOption('1000');

    // shortcuts: the commands and their state are shown
    await expect(settings.locator('#shortcut-list')).toContainText('Open search');
    await expect(settings.locator('#shortcut-list')).toContainText('Remember this page');

    // ledger: per-site rows, and "what is stored for this page"
    await expect(settings.locator('#ledger')).toContainText('deep.example.org');
    await expect(settings.locator('#ledger')).toContainText('keep.example.com');
    await settings.locator('#page-lookup').fill('https://deep.example.org/a');
    await settings.locator('#page-lookup-go').click();
    await expect(settings.locator('#page-info')).toContainText('page text');
    await expect(settings.locator('#page-info')).toContainText('orchard ledger text');
    await settings.locator('#page-lookup').fill('https://nothing.example/');
    await settings.locator('#page-lookup-go').click();
    await expect(settings.getByText('Nothing is stored for that address.')).toBeVisible();

    // delete one page: needs the confirm step
    await settings.locator('#del-page').fill('https://deep.example.org/a');
    await settings.locator('#del-page-go').click();
    expect(await urls(tool, 'orchard')).toHaveLength(1); // armed, not yet deleted
    await settings.locator('#del-page-go').click();
    await expect.poll(() => urls(tool, 'orchard')).toEqual([]);

    // delete a site from the ledger (remembered pages are kept unless asked)
    await engine(tool, { method: 'upsertContent', params: { url: 'https://keep.example.com/other', title: 'Other', body: 'plain deep text', indexedAt: Date.now() } });
    await settings.reload();
    await settings.locator('#del-site').fill('keep.example.com');
    await settings.locator('#del-site-go').click();
    await settings.locator('#del-site-go').click();
    await expect.poll(() => urls(tool, 'plain deep')).toEqual([]);
    expect(await urls(tool, 'saffron')).toHaveLength(1); // remembered page survived

    // wholesale deletes need type-to-confirm; "keep remembered" keeps Saved + snippets
    await expect(settings.locator('#del-keep-saved')).toBeDisabled();
    await expect(settings.locator('#del-everything')).toBeDisabled();
    await settings.locator('#del-type').fill('delete');
    await expect(settings.locator('#del-keep-saved')).toBeDisabled(); // case-sensitive
    await settings.locator('#del-type').fill('DELETE');
    await settings.locator('#del-keep-saved').click();
    await expect.poll(() => urls(tool, 'gizmo')).toEqual([]);
    expect(await urls(tool, 'saffron')).toHaveLength(1);
    expect(await urls(tool, 'stir slowly')).toHaveLength(1);
    expect((await engine(tool, { method: 'integrityCheck' })).ok).toBe(true);

    // export remembered items, delete everything, import them back; malformed files are rejected
    const downloading = settings.waitForEvent('download');
    await settings.locator('#export-saved').click();
    const file = join(dir, 'export.json');
    await (await downloading).saveAs(file);
    const exported = JSON.parse(readFileSync(file, 'utf8')) as { format: string; scope: string; pages: unknown[] };
    expect(exported).toMatchObject({ format: 'browser-recall-export', scope: 'saved' });
    expect(exported.pages).toHaveLength(1);
    await settings.locator('#del-everything').click();
    await expect.poll(() => urls(tool, 'saffron')).toEqual([]);
    expect((await engine(tool, { method: 'stats' })).pages).toBe(0);
    await settings.locator('#import-file').setInputFiles(file);
    await expect(settings.getByRole('status').filter({ hasText: 'Imported 1 pages' })).toBeVisible();
    expect(await urls(tool, 'saffron')).toHaveLength(1);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"format":"browser-recall-export","version":99,"pages":"x"}');
    await settings.locator('#import-file').setInputFiles(bad);
    await expect(settings.getByRole('alert').filter({ hasText: 'not a valid Browser Recall export' })).toBeVisible();
    writeFileSync(bad, 'not json at all');
    await settings.locator('#import-file').setInputFiles(bad);
    await expect(settings.getByRole('alert').filter({ hasText: 'not a valid Browser Recall export' })).toBeVisible();
    expect((await engine(tool, { method: 'stats' })).pages).toBe(1);

    // diagnostics: counts and settings only, never addresses/titles/text
    await settings.evaluate(() => {
      (navigator.clipboard as unknown as { writeText: (t: string) => Promise<void> }).writeText = async (t) => void ((window as unknown as { __copied: string }).__copied = t);
    });
    await settings.locator('#copy-diagnostics').click();
    await expect(settings.getByText('Copied.')).toBeVisible();
    const text = await settings.evaluate(() => (window as unknown as { __copied: string }).__copied);
    expect(text).not.toMatch(/https?:|keep\.example|saffron|Keeper/);
    expect(JSON.parse(text)).toMatchObject({ pages: 1, paused: false, settings: { capMb: 1000, retentionMonths: 12 } });
    expect(await serious(settings)).toEqual([]);

    // the whole scenario made no request outside the extension and the local fixture server
    expect(seen).toBeGreaterThan(20); // the recorder really sees extension-page and fixture traffic
    expect(outside).toEqual([]);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overlay frame is accessible (axe inside the injected search page)', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m8o-'));
  const server = await startFixtureServer();
  const origin = fixtureOrigin(server);
  try {
    const { context, extensionId } = await launchExtension(dir, { e2e: true });
    const tool = await toolPage(context, extensionId);
    const page = await context.newPage();
    await page.goto(`${origin}/f/overlay-plain.html`);
    const tabId = await tool.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, `${origin}/f/overlay-plain.html`);
    await page.bringToFront();
    await send(tool, { type: 'sw/open-search', tabId });
    await expect.poll(() => page.frames().some((f) => f.url().includes('/search.html'))).toBe(true);
    const frame = page.frames().find((f) => f.url().includes('/search.html'));
    await expect(frame!.locator('[data-engine-state="ready"]')).toBeVisible();
    await frame?.evaluate(axeSource);
    const r = await frame?.evaluate<{ violations: { id: string; impact: string }[] }>('axe.run()');
    expect((r?.violations ?? []).filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('live visit: the page is indexed immediately and its title arrives with the title-refresh alarm', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m8t-'));
  const server = await startFixtureServer();
  try {
    const { context, extensionId } = await launchExtension(dir, { e2e: true });
    const tool = await toolPage(context, extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    const page = await context.newPage();
    await page.goto(`${fixtureOrigin(server)}/f/gizmo-alpha.html`);
    await expect.poll(async () => (await engine(tool, { method: 'stats' })).pages).toBe(1);
    expect(await tool.evaluate(async () => (await chrome.alarms.getAll()).some((a) => a.name === 'br-title-refresh'))).toBe(true);
    await tool.evaluate(() => chrome.alarms.create('br-title-refresh', { when: Date.now() + 300 })); // do not wait the real 30 s
    await expect.poll(async () => (await engine(tool, { method: 'search', params: { query: 'gizmo alpha', now: Date.now() } })).results[0]?.title, { timeout: 20_000 }).toBe('Gizmo alpha');
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
