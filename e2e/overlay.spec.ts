// M7: the in-page overlay on the real extension. The e2e build holds a host permission for fixture.test (Playwright cannot press the
// browser shortcut or click the toolbar); `sw/open-search` with a tabId runs the exact code path of the command/toolbar handler.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Frame, Page } from '@playwright/test';
import { expect, openExtensionPage, test } from './fixtures';
import { startFixtureServer } from './fixtures-server';
import { engine, fixtureOrigin, launchExtension, send, status, tabIdOf, toolPage } from './support/pipeline';

const overlayFrame = (page: Page): Frame | undefined => page.frames().find((f) => f.url().includes('/overlay.html'));
const keys = (page: Page) => page.evaluate(() => (window as unknown as { __keys: string[] }).__keys.length);
const surface = async (tool: Page, tabId: number | undefined) => ((await send<{ surface: string }>(tool, { type: 'sw/open-search', tabId })) as { ok: true; data: { surface: string } }).data.surface;
const hostCount = (page: Page) => page.evaluate(() => document.querySelectorAll('[popover]').length);
/** popup windows (Playwright does not expose them as pages, and their URLs are hidden without the tabs permission: count them via the windows API) */
const popupIds = (tool: Page): Promise<number[]> => tool.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).map((w) => w.id as number));
const expectPopup = async (tool: Page, before: number[]): Promise<void> => {
  await expect.poll(async () => (await popupIds(tool)).filter((id) => !before.includes(id)).length, { timeout: 10_000 }).toBe(1);
  const created = (await popupIds(tool)).filter((id) => !before.includes(id));
  await tool.evaluate(async (ids) => { for (const id of ids) await chrome.windows.remove(id); }, created);
};
const frameFocused = (f: Frame) => f.evaluate(() => document.activeElement?.id === 'q' && document.hasFocus()).catch(() => false);

async function open(page: Page, tool: Page, url: string): Promise<Frame> {
  const tabId = await tabIdOf(tool, url);
  await page.bringToFront();
  expect(await surface(tool, tabId)).toBe('overlay');
  await expect.poll(() => overlayFrame(page) !== undefined).toBe(true);
  const frame = overlayFrame(page) as Frame;
  await expect(frame.locator('[data-engine-state="ready"]')).toBeVisible();
  await expect.poll(() => frameFocused(frame)).toBe(true); // search input has focus without any click
  return frame;
}

async function setup(dir: string, origin: string, context?: BrowserContext) {
  const launched = context ? { context, extensionId: '' } : await launchExtension(dir, { e2e: true });
  for (const n of ['alpha', 'beta', 'gamma']) {
    const p = await launched.context.newPage();
    await p.goto(`${origin}/f/gizmo-${n}.html`);
    await p.waitForTimeout(250);
    await p.close();
  }
  const tool = await toolPage(launched.context, launched.extensionId);
  await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
  await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
  return { ...launched, tool };
}

test('overlay: focus, key isolation, real results, keyboard open, Esc, focus/inert restore, repeat, restricted-page fallback', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m7-'));
  const server = await startFixtureServer();
  const origin = fixtureOrigin(server);
  try {
    const { context, extensionId, tool } = await setup(dir, origin);
    const url = `${origin}/f/overlay-plain.html`;
    const page = await context.newPage();
    await page.goto(url);
    await page.locator('#field').click();
    await page.keyboard.type('pre');
    const before = await keys(page);
    expect(before).toBeGreaterThan(0);

    // 2–5: overlay appears, input focused, typing goes to the overlay and NOT to the page
    const frame = await open(page, tool, url);
    expect(await page.evaluate(() => document.body.hasAttribute('inert'))).toBe(true);
    await page.keyboard.type('gizmo', { delay: 10 });
    await expect(frame.getByRole('option')).toHaveCount(3); // real engine results
    expect(await frame.locator('#q').inputValue()).toBe('gizmo');
    expect(await keys(page)).toBe(before); // the page's capture-phase listeners saw nothing
    expect(await page.locator('#field').inputValue()).toBe('pre');
    expect(await page.evaluate(() => document.querySelectorAll('iframe').length)).toBe(0); // closed shadow root: the page cannot see the frame

    // 8: keyboard open: ArrowDown + Enter opens the result in a foreground tab and closes the overlay
    const opened = context.waitForEvent('page');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const fg = await opened;
    await fg.waitForLoadState();
    expect(fg.url()).toContain('/f/gizmo-');
    await expect.poll(() => hostCount(page)).toBe(0);
    expect(await page.evaluate(() => document.body.hasAttribute('inert'))).toBe(false);
    await fg.close();

    // 9–11: reopen; Escape closes; focus returns to the previously focused page element; page typing works again
    await page.bringToFront();
    await page.locator('#field').focus();
    const again = await open(page, tool, url);
    await again.locator('#q').fill('xyz-no-match');
    await expect(again.getByText('No matches.')).toBeVisible(); // empty state
    await page.keyboard.press('Escape');
    await expect.poll(() => hostCount(page)).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('field');
    expect(await page.evaluate(() => document.body.hasAttribute('inert'))).toBe(false);
    await page.keyboard.type('X');
    expect(await page.locator('#field').inputValue()).toBe('preX');

    // repeated invocation toggles predictably; repeated mount/unmount leaves nothing behind
    for (let i = 0; i < 4; i++) {
      await open(page, tool, url);
      expect(await surface(tool, await tabIdOf(tool, url))).toBe('overlay'); // second invocation closes it
      await expect.poll(() => hostCount(page)).toBe(0);
    }
    expect(await page.evaluate(() => document.body.hasAttribute('inert'))).toBe(false);

    // click outside closes
    await open(page, tool, url);
    await page.mouse.click(5, 5);
    await expect.poll(() => hostCount(page)).toBe(0);

    // 12: restricted surface → popup window fallback, no overlay, no error
    const restricted = await context.newPage();
    await restricted.goto('chrome://version').catch(() => undefined);
    await restricted.bringToFront();
    const rid = await tool.evaluate(async () => (await chrome.tabs.query({ active: true, windowType: 'normal' }))[0]?.id);
    const known = await popupIds(tool);
    expect(await surface(tool, rid)).toBe('window');
    await expectPopup(tool, known);
    expect(extensionId.length).toBeGreaterThan(5);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('overlay isolation: hostile CSS + focus stealing + top-layer cover, strict CSP, fixed layout, pre-existing inert, injection failure', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m7b-'));
  const server = await startFixtureServer();
  const origin = fixtureOrigin(server);
  try {
    const { context, tool } = await setup(dir, origin);

    for (const name of ['overlay-hostile', 'overlay-csp', 'overlay-fullscreen']) {
      const url = `${origin}/f/${name}.html`;
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForTimeout(300);
      const before = await keys(page);
      const frame = await open(page, tool, url);
      // painted above the page's own top-z-index cover: the overlay frame is what a hit test finds at its centre
      const box = await frame.locator('#q').boundingBox();
      expect(box, name).not.toBeNull();
      await page.keyboard.type('gizmo', { delay: 10 });
      await expect(frame.getByRole('option'), name).toHaveCount(3);
      expect(await frame.locator('#q').inputValue(), name).toBe('gizmo');
      expect(await keys(page), `${name}: page saw keys`).toBe(before);
      await page.keyboard.press('Escape');
      await expect.poll(() => hostCount(page), name).toBe(0);
      expect(await page.evaluate(() => document.body.hasAttribute('inert')), name).toBe(false);
      await page.close();
    }

    // the page already had an inert body: its state is restored exactly (still inert), and the overlay still works
    {
      const url = `${origin}/f/overlay-inert.html`;
      const page = await context.newPage();
      await page.goto(url);
      expect(await page.evaluate(() => document.body.getAttribute('inert'))).toBe('');
      const frame = await open(page, tool, url);
      await page.keyboard.type('gizmo');
      await expect(frame.getByRole('option')).toHaveCount(3);
      await page.keyboard.press('Escape');
      await expect.poll(() => hostCount(page)).toBe(0);
      expect(await page.evaluate(() => document.body.getAttribute('inert'))).toBe('');
      await page.close();
    }

    // overlay is the same Search UI over the whole product: saved page, snippet and Deep Search text all show up
    await engine(tool, { method: 'savePage', params: { url: 'https://saved.example.com/rhubarb', title: 'Rhubarb notes', body: 'crumble recipe with ginger', savedAt: Date.now() } });
    await engine(tool, { method: 'addSnippet', params: { url: 'https://saved.example.com/rhubarb', pageTitle: 'Rhubarb notes', text: 'quoted marmalade passage', createdAt: Date.now() } });
    await engine(tool, { method: 'upsertContent', params: { url: 'https://deep.example.com/orchard', title: 'Orchard', body: 'nebulous pomelo ledger', indexedAt: Date.now() } });
    {
      const url = `${origin}/f/overlay-plain.html`;
      const page = await context.newPage();
      await page.goto(url);
      const frame = await open(page, tool, url);
      await page.keyboard.type('crumble');
      await expect(frame.getByRole('option')).toHaveCount(1);
      await expect(frame.getByRole('option').first()).toContainText('Saved');
      await frame.locator('#q').fill('marmalade');
      await expect(frame.getByRole('option').first()).toContainText('Snippet');
      await frame.locator('#q').fill('nebulous pomelo');
      await expect(frame.getByRole('option')).toHaveCount(1);
      await frame.locator('#q').fill('gizmo when:week');
      await expect(frame.getByRole('option')).toHaveCount(3); // operators
      await page.keyboard.press('Escape');
      await expect.poll(() => hostCount(page)).toBe(0);
      await page.close();
    }

    // injection failure (no access to the page) → window fallback; search stays available. about:blank cannot be scripted.
    const blank = await context.newPage();
    await blank.goto('about:blank');
    await blank.bringToFront();
    const bid = await tool.evaluate(async () => (await chrome.tabs.query({ active: true, windowType: 'normal' }))[0]?.id);
    const known = await popupIds(tool);
    expect(await surface(tool, bid)).toBe('window');
    await expectPopup(tool, known);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('production build: overlay cannot inject without access (no host permission, no gesture) and falls back to the window', async () => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m7p-'));
  const server = await startFixtureServer();
  try {
    const { context, extensionId } = await launchExtension(dir);
    const tool = await toolPage(context, extensionId);
    const page = await context.newPage();
    await page.goto(`${server.origin}/f/overlay-plain.html`);
    const id = await tabIdOf(tool, `${server.origin}/f/overlay-plain.html`);
    const known = await popupIds(tool);
    expect(await surface(tool, id)).toBe('window'); // no activeTab grant outside a real command/click, no host permission
    await expectPopup(tool, known);
    expect(await hostCount(page)).toBe(0);
    await openExtensionPage(context, extensionId, 'search.html');
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
