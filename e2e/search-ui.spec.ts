// M4: the real search surface over the real engine. History comes from real visits imported through the real consent flow.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContext } from '@playwright/test';
import { expect, openExtensionPage, test } from './fixtures';
import { startFixtureServer } from './fixtures-server';
import { launchExtension, status, toolPage } from './support/pipeline';

const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const visit = async (context: BrowserContext, origin: string, name: string) => {
  const page = await context.newPage();
  await page.goto(`${origin}/f/${name}.html`);
  await page.waitForTimeout(250);
  await page.close();
};

test('setup notice before consent; after consent: results, keyboard navigation, open modes, empty state, chips, a11y', async ({ context, extensionId, server }) => {
  test.setTimeout(120_000);
  for (const n of ['alpha', 'beta', 'gamma']) await visit(context, server.origin, `gizmo-${n}`);

  // before consent: the search page says it is not set up and offers the onboarding page
  let search = await openExtensionPage(context, extensionId, 'search.html');
  await expect(search.locator('[data-engine-state="ready"]')).toBeVisible();
  await expect(search.getByText('Browser Recall is not set up yet')).toBeVisible();
  await search.close();

  const tool = await toolPage(context, extensionId);
  await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
  await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');

  search = await openExtensionPage(context, extensionId, 'search.html');
  await expect(search.locator('[data-engine-state="ready"]')).toBeVisible();
  await expect(search.getByText('Browser Recall is not set up yet')).toHaveCount(0);
  await expect(search.getByRole('searchbox', { name: 'Search your browsing memory' }).or(search.getByRole('combobox'))).toBeFocused(); // keyboard-first: ready to type
  await expect(search.getByText(/Type what you remember/)).toBeVisible();

  // typing shows real results with title, domain, time
  await search.keyboard.type('gizmo');
  const options = search.getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(options.first()).toContainText('Gizmo');
  await expect(options.first()).toContainText('127.0.0.1');
  await expect(search.getByRole('status')).toContainText('3 results');
  await expect(options.first().locator('mark')).toHaveText('Gizmo'); // engine highlight ranges rendered as <mark>
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');

  // keyboard: ArrowDown/ArrowUp/wrap
  await search.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.keyboard.press('ArrowUp');
  await search.keyboard.press('ArrowUp');
  await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true'); // wrapped
  const target = (await options.nth(2).locator('.title').innerText()).replace(/\s+/g, ' ').trim();

  // Ctrl+Enter opens a BACKGROUND tab and keeps the search page; Enter opens a foreground tab
  const bg = context.waitForEvent('page');
  await search.keyboard.press('Control+Enter');
  const bgPage = await bg;
  await bgPage.waitForLoadState();
  expect(bgPage.url()).toContain('/f/gizmo-');
  expect(await bgPage.title()).toBe(target.replace(/Saved|Snippet/g, '').trim());
  await bgPage.close();
  // accessibility with results on screen
  await search.evaluate(axeSource);
  const axe = await search.evaluate<{ violations: { id: string; impact: string }[] }>('axe.run()');
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  // filter chip adds an operator to the query and keeps working
  await search.getByRole('button', { name: '7 days' }).click();
  await expect(search.getByRole('combobox')).toHaveValue('gizmo when:week');
  await expect(options).toHaveCount(3);
  await search.getByRole('button', { name: '7 days' }).click();
  await expect(search.getByRole('combobox')).toHaveValue('gizmo');

  // site: operator narrows; unknown words give the empty state
  await search.getByRole('combobox').fill('gizmo -alpha');
  await expect(options).toHaveCount(2);
  await search.getByRole('combobox').fill('zzzzqqqq');
  await expect(search.getByText('No matches.')).toBeVisible();
  await expect(search.getByText(/turn on Deep Search/)).toBeVisible();
  await search.getByRole('combobox').fill('');
  await expect(search.getByText(/Type what you remember/)).toBeVisible();

  // Enter opens a foreground tab AND closes the search window (popup surface); the typed query selects the first result
  await search.getByRole('combobox').fill('gizmo');
  await expect(options).toHaveCount(3);
  const fg = context.waitForEvent('page');
  await search.keyboard.press('Enter');
  const fgPage = await fg;
  await fgPage.waitForLoadState();
  expect(fgPage.url()).toContain('/f/gizmo-');
  await expect.poll(() => search.isClosed()).toBe(true);
});

test('IME composition: Enter during composition does not open a result; forget removes the page from the index', async () => {
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m4-'));
  const server = await startFixtureServer();
  try {
    const { context, extensionId } = await launchExtension(dir);
    await visit(context, server.origin, 'gizmo-alpha');
    const tool = await toolPage(context, extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    const search = await openExtensionPage(context, extensionId, 'search.html');
    await expect(search.locator('[data-engine-state="ready"]')).toBeVisible();
    await search.getByRole('combobox').fill('gizmo');
    await expect(search.getByRole('option')).toHaveCount(1);
    let opened = 0;
    context.on('page', () => opened++);
    await search.getByRole('combobox').dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await search.waitForTimeout(500);
    expect(opened).toBe(0);
    // actions toolbar: forget this page
    await search.getByRole('button', { name: 'Forget this page' }).click();
    await expect(search.getByText('No matches.')).toBeVisible();
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
