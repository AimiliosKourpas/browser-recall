import { describe, expect, it } from 'vitest';
import type { ExtractResult } from '../src/capture/extractor';
import { rememberTab, saveSelection, type RememberDeps } from '../src/background/remember';
import type { EngineCall, EngineResults } from '../src/engine/contract';
import { handleCall } from '../src/engine/handlers';
import { NOW, newStore } from './helpers/engine';

async function setup(extract: RememberDeps['extract'], selection = '') {
  const { store } = await newStore();
  const badges: string[] = [];
  const deps: RememberDeps = {
    engine: { call: async <C extends EngineCall>(c: C) => handleCall(c, { info: { protocol: 1, instanceId: 't' }, getStore: async () => store }) as Promise<EngineResults[C['method']]> },
    extract,
    readSelection: async () => selection,
    badge: (_id, kind) => void badges.push(kind),
    now: () => NOW,
  };
  return { store, deps, badges };
}
const page: ExtractResult = { ok: true, title: 'Rhubarb Guide', description: 'all about rhubarb', headings: 'Growing · Cooking', text: 'Rhubarb crumble is a classic dessert.', lang: 'en', truncated: false };
const search = (store: Awaited<ReturnType<typeof setup>>['store'], q: string) => store.search({ query: q, now: NOW }).results;

describe('Remember this page', () => {
  it('stores title, text, headings; the page is findable by body text and marked saved', async () => {
    const { store, deps, badges } = await setup(async () => page);
    expect(await rememberTab({ id: 1, url: 'https://a.example/rhubarb#top', title: 'tab title' }, deps)).toEqual({ ok: true, mode: 'full' });
    const r = search(store, 'crumble is:saved');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ url: 'https://a.example/rhubarb', title: 'Rhubarb Guide', source: 'saved' });
    expect(r[0]?.snippet?.text).toContain('crumble');
    expect(badges).toEqual(['saved']);
  });
  it('is idempotent: repeating Remember keeps one page; a changed page replaces the stored text', async () => {
    let text = 'first version about apples';
    const { store, deps } = await setup(async () => ({ ...page, text }));
    await rememberTab({ id: 1, url: 'https://a.example/p' }, deps);
    await rememberTab({ id: 1, url: 'https://a.example/p' }, deps);
    expect(store.stats()).toMatchObject({ pages: 1, saved: 1 });
    text = 'second version about pears';
    await rememberTab({ id: 1, url: 'https://a.example/p' }, deps);
    expect(search(store, 'apples')).toEqual([]);
    expect(search(store, 'pears')).toHaveLength(1);
  });
  it('works for a page that already exists through history (keeps history flag and visit data)', async () => {
    const { store, deps } = await setup(async () => page);
    store.upsertHistory([{ url: 'https://a.example/rhubarb', title: 'From history', lastVisitTime: NOW - 86_400_000, visitCount: 7 }]);
    await rememberTab({ id: 1, url: 'https://a.example/rhubarb' }, deps);
    const r = search(store, 'rhubarb')[0];
    expect(r?.flags).toEqual({ history: true, content: true, saved: true });
    expect(r?.visitCount).toBe(7);
    expect(store.stats().pages).toBe(1);
  });
  it('restricted pages (chrome://, extension pages, no URL): nothing stored, failure badge, no crash', async () => {
    const { store, deps, badges } = await setup(async () => page);
    for (const url of ['chrome://version', 'chrome-extension://abc/x.html', 'about:blank', undefined]) expect(await rememberTab({ id: 1, url }, deps)).toEqual({ ok: false, reason: 'restricted' });
    expect(await rememberTab({ url: 'https://a.example/' }, deps)).toEqual({ ok: false, reason: 'no-tab' });
    expect(store.stats().pages).toBe(0);
    expect(badges).toEqual(['failed', 'failed', 'failed', 'failed']);
  });
  it('an http(s) page that cannot be scripted (e.g. the Web Store) is saved title + URL only', async () => {
    const { store, deps } = await setup(async () => {
      throw new Error('The extensions gallery cannot be scripted.');
    });
    expect(await rememberTab({ id: 1, url: 'https://chromewebstore.google.com/detail/x', title: 'Some extension' }, deps)).toEqual({ ok: true, mode: 'title-only' });
    expect(search(store, 'extension is:saved')).toHaveLength(1);
  });
  it('an engine failure reports failure instead of throwing', async () => {
    const { deps, badges } = await setup(async () => page);
    deps.engine = { call: async () => Promise.reject(new Error('down')) } as never;
    expect(await rememberTab({ id: 1, url: 'https://a.example/' }, deps)).toEqual({ ok: false, reason: 'engine' });
    expect(badges).toEqual(['failed']);
  });
});

describe('Save selection to memory', () => {
  it('stores the exact selected text with source URL/title and a text fragment; searchable as a snippet', async () => {
    const { store, deps } = await setup(async () => page);
    expect(await saveSelection({ id: 1, url: 'https://a.example/q#x', title: 'Quotes' }, 'to be, or not to be', deps)).toEqual({ ok: true, mode: 'full' });
    const r = search(store, 'not to be is:snippet');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'snippet', url: 'https://a.example/q', title: 'Quotes', fragment: '#:~:text=to%20be%2C%20or%20not%20to%20be' });
    expect(r[0]?.snippet?.text).toBe('to be, or not to be');
  });
  it('reads the selection from the tab when the context menu did not supply it (keyboard command); empty selection fails gracefully', async () => {
    const withSel = await setup(async () => page, 'selected by command');
    expect(await saveSelection({ id: 1, url: 'https://a.example/', title: 't' }, undefined, withSel.deps)).toMatchObject({ ok: true });
    expect(search(withSel.store, 'command is:snippet')).toHaveLength(1);
    const empty = await setup(async () => page, '   ');
    expect(await saveSelection({ id: 1, url: 'https://a.example/', title: 't' }, undefined, empty.deps)).toMatchObject({ ok: false });
    expect(empty.store.stats().snippets).toBe(0);
  });
  it('very long selections are truncated and flagged by the engine; restricted pages are refused', async () => {
    const { store, deps } = await setup(async () => page);
    await saveSelection({ id: 1, url: 'https://a.example/', title: 't' }, `${'long '.repeat(2000)}end`, deps);
    expect(search(store, 'long is:snippet')[0]?.snippet?.text.length).toBeLessThanOrEqual(401);
    expect(await saveSelection({ id: 1, url: 'chrome://version' }, 'x', deps)).toEqual({ ok: false, reason: 'restricted' });
  });
});

describe('saved items vs history deletion, and removing them', () => {
  it('saved page and snippet survive history deletion and delete-all; unremember removes only the saved state', async () => {
    const { store, deps } = await setup(async () => page);
    store.upsertHistory([{ url: 'https://a.example/rhubarb', title: 'Rhubarb', lastVisitTime: NOW }]);
    await rememberTab({ id: 1, url: 'https://a.example/rhubarb' }, deps);
    await saveSelection({ id: 1, url: 'https://a.example/rhubarb', title: 'Rhubarb' }, 'crumble recipe quote', deps);
    store.deleteUrls(['https://a.example/rhubarb']);
    expect(search(store, 'crumble')).toHaveLength(2); // page (saved text) + snippet
    store.deleteAllExceptSaved();
    expect(search(store, 'crumble')).toHaveLength(2);
    expect(store.unsavePage('https://a.example/rhubarb')).toEqual({ changed: true, removed: 'page' }); // no history left → page gone
    expect(search(store, 'crumble').map((r) => r.kind)).toEqual(['snippet']); // snippets are separate saved items
    const id = search(store, 'crumble')[0]?.id as number;
    expect(store.deleteSnippet(id)).toEqual({ deleted: true });
    expect(store.deleteSnippet(id)).toEqual({ deleted: false });
    expect(store.stats()).toMatchObject({ pages: 0, snippets: 0 });
    expect(store.integrityCheck().ok).toBe(true);
  });
  it('unremember keeps a page that is still in history (title/URL searchable) but drops the saved text', async () => {
    const { store, deps } = await setup(async () => page);
    store.upsertHistory([{ url: 'https://a.example/rhubarb', title: 'Rhubarb', lastVisitTime: NOW }]);
    await rememberTab({ id: 1, url: 'https://a.example/rhubarb' }, deps);
    expect(store.unsavePage('https://a.example/rhubarb')).toEqual({ changed: true, removed: 'saved-flag' });
    expect(search(store, 'crumble')).toEqual([]);
    expect(search(store, 'rhubarb')[0]?.flags).toEqual({ history: true, content: false, saved: false });
    expect(store.unsavePage('https://a.example/rhubarb')).toEqual({ changed: false, removed: 'none' });
    expect(store.unsavePage('chrome://x')).toEqual({ changed: false, removed: 'none' });
    expect(store.integrityCheck().ok).toBe(true);
  });
});
