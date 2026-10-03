import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/engine/db';
import type { SearchStore } from '../src/engine/store';
import { DAY, NOW, content, hist, newStore } from './helpers/engine';

let store: SearchStore;
let db: Db;
beforeEach(async () => {
  ({ store, db } = await newStore());
});
const urls = (q: string, extra: Record<string, unknown> = {}) => store.search({ query: q, now: NOW, ...extra }).results.map((r) => r.url);

describe('history writes', () => {
  it('inserts, then updates idempotently; title changes are reindexed; non-http(s) skipped (A6)', () => {
    // eslint-disable-next-line no-script-url -- the URL under test is data, never executed
    const rows = [hist('https://a.example/x#frag', 'Alpha Page'), hist('chrome://settings', 'Settings'), hist('chrome-extension://abc/x.html', 'ext'), hist('file:///etc/passwd', 'p'), hist('javascript:alert(1)', 'j'), hist('not a url', 'n')];
    expect(store.upsertHistory(rows)).toEqual({ inserted: 1, updated: 0, skipped: 5 });
    expect(store.upsertHistory(rows)).toEqual({ inserted: 0, updated: 1, skipped: 5 });
    expect(urls('alpha')).toEqual(['https://a.example/x']);
    store.upsertHistory([hist('https://a.example/x', 'Beta Renamed')]);
    expect(urls('alpha')).toEqual([]);
    expect(urls('renamed')).toEqual(['https://a.example/x']);
    expect(store.stats().pages).toBe(1);
  });
  it('keeps the latest visit time and updates counts', () => {
    store.upsertHistory([hist('https://a.example/', 'A', 1, { visitCount: 2 })]);
    store.upsertHistory([hist('https://a.example/', 'A', 5, { visitCount: 9 })]);
    const r = store.search({ query: 'a', now: NOW }).results[0];
    expect(r?.timestamp).toBe(NOW - DAY);
    expect(r?.visitCount).toBe(9);
  });
  it('normalises tracking params and fragments to one page', () => {
    store.upsertHistory([hist('https://a.example/p?utm_source=x&id=1#top', 'P'), hist('https://a.example/p?id=1&fbclid=zz', 'P')]);
    expect(store.stats().pages).toBe(1);
  });
});

describe('content and saved items', () => {
  it('finds a page by body text, returns a TypeScript snippet, and skips unchanged content by hash', () => {
    store.upsertHistory([hist('https://a.example/doc', 'Documentation')]);
    expect(store.upsertContent(content('https://a.example/doc', 'The quick brown fox jumps over the lazy dog near the river bank.', { contentHash: 'h1' }))).toEqual({ changed: true, skipped: false });
    expect(store.upsertContent(content('https://a.example/doc', 'ignored', { contentHash: 'h1' })).changed).toBe(false);
    const r = store.search({ query: 'lazy dog', now: NOW }).results[0];
    expect(r?.url).toBe('https://a.example/doc');
    expect(r?.source).toBe('deep');
    expect(r?.matchKind).toBe('content');
    expect(r?.snippet?.text).toContain('lazy dog');
    expect(store.stats().withContent).toBe(1);
  });
  it('re-applies caps defensively', () => {
    store.upsertContent(content('https://a.example/big', 'word '.repeat(30_000)));
    expect(store.stats().textBytes).toBeLessThanOrEqual(50_000 + 5_000 + 1_000);
  });
  it('savePage stores a saved item that is found with is:saved and ranks as saved', () => {
    store.upsertHistory([hist('https://a.example/s', 'Saved Article')]);
    store.savePage({ url: 'https://a.example/s', title: 'Saved Article', body: 'rhubarb crumble recipe', savedAt: NOW });
    const r = store.search({ query: 'rhubarb is:saved', now: NOW }).results;
    expect(r.map((x) => x.url)).toEqual(['https://a.example/s']);
    expect(r[0]?.source).toBe('saved');
  });
  it('title-only saved page (restricted page) is searchable by title', () => {
    store.savePage({ url: 'https://a.example/pdf', title: 'Quarterly Report', savedAt: NOW });
    expect(urls('quarterly is:saved')).toEqual(['https://a.example/pdf']);
  });
  it('snippets: found by quote text, is:snippet filter, truncated flag, survive page deletion', () => {
    store.upsertHistory([hist('https://a.example/q', 'Quotes')]);
    const a = store.addSnippet({ url: 'https://a.example/q', pageTitle: 'Quotes', text: 'to be or not to be', fragment: '#:~:text=to%20be', createdAt: NOW });
    expect(a).toMatchObject({ truncated: false });
    const long = store.addSnippet({ url: 'https://a.example/q', text: 'x'.repeat(6000), createdAt: NOW });
    expect(long).toMatchObject({ truncated: true });
    const r = store.search({ query: 'not to be is:snippet', now: NOW }).results;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'snippet', source: 'snippet', fragment: '#:~:text=to%20be' });
    store.deleteEverything();
    expect(store.stats().snippets).toBe(0);
  });
  it('rejects non-http(s) URLs for content, saved pages and snippets', () => {
    expect(store.upsertContent(content('chrome://x', 'a')).skipped).toBe(true);
    expect(store.savePage({ url: 'file:///x', title: 't', savedAt: NOW }).skipped).toBe(true);
    expect(store.addSnippet({ url: 'data:text/html,x', text: 'a', createdAt: NOW })).toEqual({ skipped: true });
    expect(store.stats().pages).toBe(0);
  });
});

describe('deletion semantics (saved items survive; ADR-006 mirrored deletion)', () => {
  beforeEach(() => {
    store.upsertHistory([hist('https://keep.example/1', 'Keeper'), hist('https://drop.example/1', 'Dropper one', 3), hist('https://drop.example/2', 'Dropper two', 40), hist('https://sub.drop.example/3', 'Dropper sub', 3), hist('https://other.example/', 'Other', 100)]);
    store.upsertContent(content('https://drop.example/1', 'sunflower field'));
    store.savePage({ url: 'https://keep.example/1', title: 'Keeper', body: 'important notes', savedAt: NOW });
    store.addSnippet({ url: 'https://keep.example/1', text: 'important quote', createdAt: NOW });
  });
  it('deleteUrls removes plain pages (content and FTS included) and demotes saved ones', () => {
    expect(store.deleteUrls(['https://drop.example/1#x', 'https://keep.example/1'])).toEqual({ deletedPages: 1, keptSaved: 1 });
    expect(urls('sunflower')).toEqual([]);
    expect(urls('keeper')).toEqual(['https://keep.example/1']);
    expect(store.search({ query: 'keeper', now: NOW }).results[0]?.flags.history).toBe(false);
    expect(store.integrityCheck().ok).toBe(true);
  });
  it('deleteDomain covers subdomains, not look-alikes; includeSaved removes saved pages and snippets', () => {
    store.upsertHistory([hist('https://notdrop.example/', 'Lookalike')]);
    expect(store.deleteDomain('drop.example').deletedPages).toBe(3);
    expect(urls('lookalike')).toEqual(['https://notdrop.example/']);
    expect(store.deleteDomain('keep.example')).toEqual({ deletedPages: 0, keptSaved: 1 });
    expect(store.deleteDomain('keep.example', true).deletedPages).toBe(1);
    expect(store.stats().snippets).toBe(0);
  });
  it('deleteRange removes by last visit in [start, end)', () => {
    expect(store.deleteRange(NOW - 50 * DAY, NOW - 10 * DAY).deletedPages).toBe(1);
    expect(urls('two')).toEqual([]);
    expect(urls('other')).toEqual(['https://other.example/']);
  });
  it('deleteAllExceptSaved keeps saved pages and snippets', () => {
    expect(store.deleteAllExceptSaved()).toEqual({ deletedPages: 4, keptSaved: 1 });
    const s = store.stats();
    expect(s).toMatchObject({ pages: 1, saved: 1, snippets: 1, withHistory: 0 });
    expect(urls('important')).toEqual(expect.arrayContaining(['https://keep.example/1']));
    expect(store.integrityCheck().ok).toBe(true);
  });
  it('deleteEverything empties every table including FTS', () => {
    store.deleteEverything();
    expect(store.stats()).toMatchObject({ pages: 0, saved: 0, snippets: 0, textBytes: 0 });
    expect(store.integrityCheck().ok).toBe(true);
    expect(urls('important')).toEqual([]);
  });
  it('retention removes non-saved pages older than the cutoff; null keeps everything', () => {
    expect(store.applyRetention(null, NOW)).toEqual({ deletedPages: 0, keptSaved: 0 });
    expect(store.applyRetention(3, NOW).deletedPages).toBe(1); // "other" (100 d)
    expect(urls('other')).toEqual([]);
  });
});

describe('export / import', () => {
  it('saved-scope export → import into a fresh database reproduces saved items exactly, and is idempotent', async () => {
    store.upsertHistory([hist('https://a.example/s', 'Saved Page'), hist('https://a.example/h', 'History Only')]);
    store.savePage({ url: 'https://a.example/s', title: 'Saved Page', description: 'desc', headings: 'h1', body: 'grüße από την Ελλάδα', savedAt: NOW, lang: 'el' });
    store.addSnippet({ url: 'https://a.example/s', pageTitle: 'Saved Page', text: 'από την', fragment: '#:~:text=x', createdAt: NOW });
    const first = store.exportData('saved', NOW);
    expect(first.pages.map((p) => p.url)).toEqual(['https://a.example/s']);
    const fresh = await newStore();
    expect(fresh.store.importData(first)).toEqual({ pages: 1, snippets: 1, skipped: 0 });
    expect(fresh.store.importData(first)).toEqual({ pages: 1, snippets: 0, skipped: 0 });
    expect(fresh.store.exportData('saved', NOW)).toEqual(first);
    expect(fresh.store.search({ query: 'ελλαδα', now: NOW }).results[0]?.url).toBe('https://a.example/s');
  });
  it('"all" scope includes history-only pages', () => {
    store.upsertHistory([hist('https://a.example/h', 'History Only')]);
    expect(store.exportData('all', NOW).pages).toHaveLength(1);
  });
});

describe('health, stats and capped storage', () => {
  it('integrity check passes on a populated database and fails loudly on an inconsistent one', () => {
    store.upsertHistory([hist('https://a.example/1', 'One'), hist('https://a.example/2', 'Two')]);
    store.upsertContent(content('https://a.example/1', 'hello world'));
    expect(store.integrityCheck()).toMatchObject({ ok: true, consistency: { pages: 2, ftsMainDocs: 2, ftsMetaDocs: 2, consistent: true } });
    db.exec('DELETE FROM fts_meta WHERE rowid = 1'); // corrupt on purpose: page without its FTS row
    expect(store.integrityCheck().ok).toBe(false);
  });
  it('stats reports counts, text bytes and auto_vacuum=incremental', () => {
    store.upsertHistory([hist('https://a.example/1', 'One')]);
    store.upsertContent(content('https://a.example/1', 'abcde', { description: 'xy' }));
    expect(store.stats()).toMatchObject({ schemaVersion: 1, pages: 1, withHistory: 1, withContent: 1, textBytes: 7, autoVacuum: 'incremental' });
  });
  it('enforceCap trims Deep text first, then oldest pages; saved pages are never removed', () => {
    for (let i = 0; i < 60; i++) {
      store.upsertHistory([hist(`https://c.example/${i}`, `Page ${i}`, 60 - i)]);
      store.upsertContent(content(`https://c.example/${i}`, `unique${i} `.repeat(400)));
    }
    store.savePage({ url: 'https://c.example/saved', title: 'Saved', body: 'precious '.repeat(200), savedAt: NOW });
    const before = store.stats().liveBytes;
    const target = Math.floor(before * 0.5);
    const out = store.enforceCap(target);
    expect(out.trimmedContent).toBeGreaterThan(0);
    expect(out.liveBytesAfter).toBeLessThan(before);
    expect(store.search({ query: 'precious is:saved', now: NOW }).results).toHaveLength(1);
    expect(store.integrityCheck().ok).toBe(true);
    // trimmed pages stay findable by title
    expect(urls('page 1')).toContain('https://c.example/1');
    // an impossible cap deletes every non-saved page but never the saved one
    store.enforceCap(1);
    expect(store.stats()).toMatchObject({ pages: 1, saved: 1 });
  });
});
