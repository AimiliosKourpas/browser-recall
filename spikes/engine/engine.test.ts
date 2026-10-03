import { beforeAll, describe, expect, it } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { generateCorpus, generateQueries, percentile } from '../shared/corpus';
import { FtsStore, type Db } from './fts-store';
import { planRemoval, EXPIRY_GUARD_DAYS } from './deletion-policy';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
let sqlite3: Sqlite3;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});
const mem = () => new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;

describe('sqlite-wasm build', () => {
  it('has FTS5, trigram and unicode61 tokenizers', () => {
    expect(sqlite3.capi.sqlite3_compileoption_used('ENABLE_FTS5')).toBe(1);
    const db = mem();
    db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')");
    db.exec("CREATE VIRTUAL TABLE u USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
    db.close();
  });
  it('supports contentless-delete-era features we may rely on (version >= 3.45)', () => {
    const [maj, min] = sqlite3.version.libVersion.split('.').map(Number);
    expect(maj * 100 + min).toBeGreaterThanOrEqual(345);
  });
});

describe('synthetic corpus', () => {
  it('is deterministic and respects the per-page cap', () => {
    const a = generateCorpus({ pages: 50, seed: 1 });
    const b = generateCorpus({ pages: 50, seed: 1 });
    expect(a).toEqual(b);
    expect(Math.max(...a.map((d) => d.body.length))).toBeLessThanOrEqual(50_100);
    expect(new Set(a.map((d) => d.url)).size).toBe(50);
  });
  it('percentile helper', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
  });
});

describe('FtsStore', () => {
  it('finds a page by a body term, with prefix on the last term, and builds a snippet', () => {
    const store = new FtsStore(mem());
    store.insertAll([
      { id: 1, url: 'https://a.example/1', domain: 'a.example', title: 'Alpha', body: 'the quick brown fox jumps over the lazy dog', lastVisit: 1, visitCount: 1 },
      { id: 2, url: 'https://b.example/2', domain: 'b.example', title: 'Beta', body: 'nothing relevant here', lastVisit: 2, visitCount: 1 },
    ]);
    const hits = store.search('brown fo');
    expect(hits.map((h) => h.id)).toEqual([1]);
    expect(store.snippetsTs('brown fo', [1])[0]).toContain('brown');
  });
  it('applies domain (incl. subdomain) and date filters', () => {
    const store = new FtsStore(mem());
    store.insertAll([
      { id: 1, url: 'https://x.a.example/1', domain: 'x.a.example', title: 't', body: 'common word', lastVisit: 100, visitCount: 1 },
      { id: 2, url: 'https://a.example/2', domain: 'a.example', title: 't', body: 'common word', lastVisit: 200, visitCount: 1 },
      { id: 3, url: 'https://b.example/3', domain: 'b.example', title: 't', body: 'common word', lastVisit: 300, visitCount: 1 },
    ]);
    expect(store.search('common', { domain: 'a.example' }).map((h) => h.id).sort()).toEqual([1, 2]);
    expect(store.search('common', { after: 150 }).map((h) => h.id).sort()).toEqual([2, 3]);
  });
  it('never lets user text reach SQL or FTS5 syntax: hostile queries do not throw', () => {
    const store = new FtsStore(mem());
    store.insertAll(generateCorpus({ pages: 20, seed: 3 }));
    for (const q of ['"', '""', "'; DROP TABLE pages; --", 'a AND OR NOT', 'NEAR(a b)', '*', 'col:thing', '(((', 'title:x', '\\', '%_']) {
      expect(() => store.search(q)).not.toThrow();
    }
    expect(store.count()).toBe(20);
  });
  it('top hit for a distinctive title word is the page it came from (sanity relevance)', () => {
    const docs = generateCorpus({ pages: 300, seed: 9 });
    const store = new FtsStore(mem());
    store.insertAll(docs);
    let top5 = 0;
    const sample = docs.slice(0, 40);
    for (const d of sample) {
      const word = d.title.split(' ').sort((a, b) => b.length - a.length)[0];
      if (store.search(word).slice(0, 5).some((h) => h.id === d.id)) top5++;
    }
    expect(top5 / sample.length).toBeGreaterThan(0.6);
  });
});

describe('FINDING: unicode61 remove_diacritics 2 alone does not fold Greek accents', () => {
  it('raw FTS5 table: "λογος" does not match "λόγος", "λόγος" does not match "λογος"', () => {
    const db = mem();
    db.exec("CREATE VIRTUAL TABLE r USING fts5(x, tokenize='unicode61 remove_diacritics 2')");
    db.exec("INSERT INTO r(rowid,x) VALUES(1,'λόγος'),(2,'λογος'),(3,'café')");
    const hit = (q: string) => db.selectArrays('SELECT rowid FROM r WHERE r MATCH ?', [`"${q}"`]).flat();
    expect(hit('λογος')).toEqual([2]); // Greek tonos NOT folded
    expect(hit('λόγος')).toEqual([1]);
    expect(hit('cafe')).toEqual([3]); // Latin diacritics ARE folded
    expect(hit('ΛΟΓΟΣ')).toEqual([2]); // case and final sigma fold fine
  });
});

describe('Greek and accent handling (TypeScript fold() + unicode61)', () => {
  const docs = [
    { id: 1, title: 'Βιβλίο συνταγών', body: 'Το καλύτερο βιβλίο για μαγειρική και ΖΑΧΑΡΩΤΑ γλυκά.' },
    { id: 2, title: 'Λόγος', body: 'Ο λόγος του Σωκράτη, οι λόγοι και τα βιβλία.' },
    { id: 3, title: 'Café', body: 'Un café très agréable à Zürich, naïve résumé.' },
    { id: 4, title: 'ΟΔΟΣ ΕΡΜΟΥ', body: 'ΑΘΗΝΑ ΕΛΛΑΔΑ' },
  ].map((d) => ({ ...d, url: `https://x.example/${d.id}`, domain: 'x.example', lastVisit: d.id, visitCount: 1 }));
  const ids = (s: FtsStore, q: string) => s.search(q).map((h) => h.id).sort();
  let store: FtsStore;
  beforeAll(() => {
    store = new FtsStore(mem());
    store.insertAll(docs);
  });
  it('folds tonos and case: "βιβλίο" == "βιβλιο" == "ΒΙΒΛΊΟ"', () => {
    expect(ids(store, 'βιβλιο')).toContain(1);
    expect(ids(store, 'ΒΙΒΛΊΟ')).toContain(1);
    expect(ids(store, 'βιβλίο')).toContain(1);
  });
  it('folds uppercase body text to lowercase queries and accents ("ζαχαρωτα", "αθηνα")', () => {
    expect(ids(store, 'ζαχαρωτα')).toEqual([1]);
    expect(ids(store, 'αθηνα')).toEqual([4]);
  });
  it('folds final sigma: "λόγος" == "ΛΟΓΟΣ" == "λογοσ"', () => {
    expect(ids(store, 'λογος')).toContain(2);
    expect(ids(store, 'ΛΟΓΟΣ')).toContain(2);
    expect(ids(store, 'λογοσ')).toContain(2);
  });
  it('prefix (>=3 chars via prefix index) stands in for stemming: "βιβλ" reaches both βιβλίο and βιβλία', () => {
    expect(ids(store, 'βιβλ')).toEqual([1, 2]);
  });
  it('KNOWN LIMIT: no stemming — full-word "βιβλίο" does not match the plural "βιβλία" in doc 2', () => {
    expect(ids(store, 'βιβλίο')).not.toContain(2);
    expect(ids(store, 'λόγος')).not.toContain(1);
  });
  it('2-char prefixes still work (term scan, no prefix index)', () => {
    expect(ids(store, 'βι')).toEqual([1, 2]);
  });
  it('Latin diacritics fold: "cafe", "zurich", "naive resume"', () => {
    expect(ids(store, 'cafe')).toEqual([3]);
    expect(ids(store, 'zurich')).toEqual([3]);
    expect(ids(store, 'naive resume')).toEqual([3]);
  });
  it('trigram fallback on titles/URLs is accent- and case-insensitive thanks to fold()', () => {
    expect(store.searchMeta('ιβλί')).toEqual([1]);
    expect(store.searchMeta('ΙΒΛΊ')).toEqual([1]);
    expect(store.searchMeta('ιβλι')).toEqual([1]);
  });
  it('deleting a page removes it from FTS (contentless_delete)', () => {
    const s2 = new FtsStore(mem());
    s2.insertAll([docs[0]]);
    expect(ids(s2, 'βιβλιο')).toEqual([1]);
    s2.db.exec('DELETE FROM fts_main WHERE rowid=1');
    expect(ids(s2, 'βιβλιο')).toEqual([]);
  });
});

describe('ADR-006 deletion/expiry policy', () => {
  const now = Date.UTC(2026, 9, 3);
  const day = 86_400_000;
  const last = (m: Record<string, number>) => (u: string) => m[u];
  it('allHistory deletes everything except saved', () => {
    expect(planRemoval({ allHistory: true, urls: [] }, () => undefined, now).deleteAllExceptSaved).toBe(true);
  });
  it('a recent URL removal mirrors', () => {
    const p = planRemoval({ allHistory: false, urls: ['u1'] }, last({ u1: now - 3 * day }), now);
    expect(p.deleteUrls).toEqual(['u1']);
  });
  it('a removal of a URL whose last visit is older than the guard is treated as Chrome expiry and ignored', () => {
    const p = planRemoval({ allHistory: false, urls: ['old', 'new'] }, last({ old: now - (EXPIRY_GUARD_DAYS + 1) * day, new: now - day }), now);
    expect(p.ignoredAsExpiry).toEqual(['old']);
    expect(p.deleteUrls).toEqual(['new']);
  });
  it('allHistory is honoured even for old data', () => {
    expect(planRemoval({ allHistory: true, urls: [] }, last({ old: now - 200 * day }), now).deleteAllExceptSaved).toBe(true);
  });
  it('empty-urls partial-visit events and unknown URLs are no-ops', () => {
    expect(planRemoval({ allHistory: false, urls: [] }, () => undefined, now)).toEqual({ deleteAllExceptSaved: false, deleteUrls: [], ignoredAsExpiry: [] });
    expect(planRemoval({ allHistory: false, urls: ['nope'] }, () => undefined, now).deleteUrls).toEqual([]);
  });
  it('setting mirrorDeletion=false disables everything; expiryGuard=false mirrors old removals', () => {
    expect(planRemoval({ allHistory: true, urls: [] }, () => undefined, now, { mirrorDeletion: false, expiryGuard: true }).deleteAllExceptSaved).toBe(false);
    expect(planRemoval({ allHistory: false, urls: ['old'] }, last({ old: now - 100 * day }), now, { mirrorDeletion: true, expiryGuard: false }).deleteUrls).toEqual(['old']);
  });
});

describe('query generator', () => {
  it('produces non-empty queries', () => {
    const docs = generateCorpus({ pages: 30, seed: 5 });
    expect(generateQueries(docs, 10, 1, 'distinctive').every((q) => q.length > 0)).toBe(true);
  });
});
