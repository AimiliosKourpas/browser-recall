// M5: Remember / Save selection / saved items vs history deletion / unremember, on the real extension. Uses the e2e build
// (host permission for the fixture host) because Playwright cannot trigger activeTab (context menu / shortcut).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, openExtensionPage, test } from './fixtures';
import { startFixtureServer } from './fixtures-server';
import { engine, fixtureOrigin, launchExtension, send, status, tabIdOf, toolPage, urls } from './support/pipeline';

test('Remember → saved + searchable by body text → snippet with text fragment → survives history deletion → unremember', async () => {
  test.setTimeout(150_000);
  const dir = mkdtempSync(join(tmpdir(), 'br-m5-'));
  const server = await startFixtureServer();
  const url = `${fixtureOrigin(server)}/f/rhubarb.html`;
  try {
    const { context, extensionId } = await launchExtension(dir, { e2e: true });
    const article = await context.newPage();
    await article.goto(url);
    const tool = await toolPage(context, extensionId);
    await tool.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/grant-consent', version: 1 }));
    await expect.poll(async () => (await status(tool)).importStatus, { timeout: 30_000 }).toBe('complete');
    expect(await urls(tool, 'zorblax')).toEqual([]); // history knows only the title and URL: body text is not indexed (Deep Search is off)

    // Remember (what the context menu and the keyboard command do)
    const tabId = await tabIdOf(tool, url);
    expect(tabId).toBeDefined();
    expect(await send(tool, { type: 'sw/remember-tab', tabId })).toMatchObject({ ok: true, data: { ok: true, mode: 'full' } });
    expect(await send(tool, { type: 'sw/remember-tab', tabId })).toMatchObject({ ok: true, data: { ok: true } }); // idempotent
    const hit = await engine(tool, { method: 'search', params: { query: 'zorblax quartz is:saved', now: Date.now() } });
    expect(hit.results).toHaveLength(1);
    expect(hit.results[0]).toMatchObject({ url, source: 'saved', title: 'Garden notes', flags: { history: true, content: true, saved: true } });
    expect(hit.results[0]?.snippet?.text).toContain('zorblax-quartz');
    expect((await engine(tool, { method: 'stats' })).pages).toBe(1); // merged with the history record
    expect(await urls(tool, 'ρεβιθαδα')).toEqual([url]); // Greek body text, accent- and case-insensitive
    expect(await urls(tool, 'ginger')).toEqual([url]);
    expect(await urls(tool, 'copyright')).toEqual([]); // footer boilerplate was not extracted
    expect(await urls(tool, 'contact')).toEqual([]);
    expect((await article.evaluate(() => document.querySelectorAll('*').length)) > 0).toBe(true);

    // Save selection
    await article.evaluate(() => {
      const el = document.getElementById('p1')?.firstChild as Text;
      const range = document.createRange();
      range.setStart(el, 0);
      range.setEnd(el, 'Rhubarb crumble is a classic dessert'.length);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    });
    expect(await send(tool, { type: 'sw/save-selection', tabId })).toMatchObject({ ok: true, data: { ok: true } });
    const snip = (await engine(tool, { method: 'search', params: { query: 'classic dessert is:snippet', now: Date.now() } })).results;
    expect(snip).toHaveLength(1);
    expect(snip[0]).toMatchObject({ kind: 'snippet', url, title: 'Garden notes', fragment: '#:~:text=Rhubarb%20crumble%20is%20a%20classic%20dessert' });
    expect(snip[0]?.snippet?.text).toBe('Rhubarb crumble is a classic dessert'); // the exact selected text

    // the search UI shows both as saved items; opening the snippet goes to the passage (text fragment)
    const search = await openExtensionPage(context, extensionId, 'search.html');
    await expect(search.locator('[data-engine-state="ready"]')).toBeVisible();
    await search.getByRole('combobox').fill('classic dessert');
    await expect(search.getByRole('option')).toHaveCount(2);
    await expect(search.getByRole('option').filter({ hasText: 'Snippet' })).toHaveCount(1);
    await expect(search.getByRole('option').filter({ hasText: 'Saved' })).toHaveCount(1);
    await search.getByRole('combobox').fill('classic dessert is:snippet');
    await expect(search.getByRole('option')).toHaveCount(1);
    const opened = context.waitForEvent('page');
    await search.keyboard.press('Control+Enter');
    const target = await opened;
    await target.waitForLoadState();
    const navUrl = await target.evaluate(() => performance.getEntriesByType('navigation')[0]?.name ?? '');
    expect(`${target.url()} ${navUrl}`).toContain(':~:text=Rhubarb%20crumble');
    await target.close();

    // history deletion in Chrome: saved page and snippet survive (history flag cleared)
    await tool.evaluate((u) => chrome.history.deleteUrl({ url: u }), url);
    await expect.poll(async () => (await engine(tool, { method: 'search', params: { query: 'zorblax', now: Date.now() } })).results[0]?.flags.history, { timeout: 15_000 }).toBe(false);
    expect(await urls(tool, 'zorblax quartz is:saved')).toEqual([url]);
    expect((await engine(tool, { method: 'search', params: { query: 'classic is:snippet', now: Date.now() } })).results).toHaveLength(1);
    await tool.evaluate(() => chrome.history.deleteAll());
    await tool.waitForTimeout(1500);
    expect(await urls(tool, 'zorblax')).toEqual([url]);

    // unremember (row action): the saved page goes (it has no history left), the snippet is a separate item
    await search.getByRole('combobox').fill('zorblax is:saved');
    await expect(search.getByRole('option')).toHaveCount(1);
    await search.getByRole('button', { name: 'Remove from saved' }).click();
    await expect(search.getByText('No matches.')).toBeVisible();
    expect(await urls(tool, 'zorblax')).toEqual([]);
    await search.getByRole('combobox').fill('classic is:snippet');
    await expect(search.getByRole('option')).toHaveCount(1);
    await search.getByRole('button', { name: 'Delete snippet' }).click();
    await expect(search.getByText('No matches.')).toBeVisible();
    expect((await engine(tool, { method: 'stats' })).snippets).toBe(0);
    expect((await engine(tool, { method: 'integrityCheck' })).ok).toBe(true);

    // restricted Chrome pages fail gracefully
    const restricted = await context.newPage();
    await restricted.goto('chrome://version');
    await restricted.bringToFront();
    const restrictedId = await tool.evaluate(async () => (await chrome.tabs.query({ active: true, windowType: 'normal' }))[0]?.id); // titles/URLs of such tabs are hidden from the extension
    expect(restrictedId).toBeDefined();
    expect(await send(tool, { type: 'sw/remember-tab', tabId: restrictedId })).toMatchObject({ ok: true, data: { ok: false, reason: 'restricted' } });
    expect(await send(tool, { type: 'sw/save-selection', tabId: restrictedId })).toMatchObject({ ok: true, data: { ok: false } });
    expect((await engine(tool, { method: 'stats' })).pages).toBe(0);
    await context.close();
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
