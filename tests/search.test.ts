import { beforeEach, describe, expect, it } from 'vitest';
import type { SearchStore } from '../src/engine/store';
import { DAY, NOW, content, hist, newStore } from './helpers/engine';

let store: SearchStore;
beforeEach(async () => {
  ({ store } = await newStore());
});
const search = (query: string, extra: Record<string, unknown> = {}) => store.search({ query, now: NOW, ...extra });
/** exact matches only: relaxed (approximate) results are asserted explicitly in their own tests */
const urls = (q: string, extra: Record<string, unknown> = {}) => search(q, extra).results.filter((r) => !r.approximate).map((r) => r.url);

function seed() {
  store.upsertHistory([
    hist('https://rust.example/book', 'The Rust Programming Language', 2, { visitCount: 5 }),
    hist('https://rust.example/crates', 'Crates and Cargo', 10),
    hist('https://docs.example/python', 'Python Tutorial', 3),
    hist('https://news.example/a', 'Local news today', 0),
    hist('https://sub.news.example/b', 'Subdomain news', 20),
    hist('https://blog.example/greek', 'Βιβλίο συνταγών', 5),
    hist('https://blog.example/greek2', 'Ο Λόγος του Σωκράτη', 6),
  ]);
  store.upsertContent(content('https://rust.example/book', 'Ownership and borrowing are the core ideas. The borrow checker enforces memory safety without a garbage collector.'));
  store.upsertContent(content('https://docs.example/python', 'Python is a programming language. Indentation matters, and lists are mutable.', { headings: 'Introduction Variables Loops', description: 'learn python' }));
  store.upsertContent(content('https://blog.example/greek', 'Το καλύτερο βιβλίο για μαγειρική και ΖΑΧΑΡΩΤΑ γλυκά στην Αθήνα.'));
}

describe('basic search semantics', () => {
  beforeEach(seed);
  it('matches title words, body words and headings; AND semantics', () => {
    expect(urls('rust')).toContain('https://rust.example/book');
    expect(urls('borrow checker')).toEqual(['https://rust.example/book']);
    expect(urls('indentation')).toEqual(['https://docs.example/python']);
    expect(urls('variables loops')).toEqual(['https://docs.example/python']); // headings column
    expect(urls('learn')).toEqual(['https://docs.example/python']); // description column
    expect(urls('rust python')).toEqual([]);
  });
  it('last word is a prefix (typing behaviour), earlier words are whole words', () => {
    expect(urls('rust prog')).toEqual(['https://rust.example/book']);
    expect(urls('rus')).toContain('https://rust.example/book');
    expect(urls('ru borrow')).toEqual([]); // "ru" is not a whole word
  });
  it('phrase queries: contiguous words only', () => {
    expect(urls('"borrow checker"')).toEqual(['https://rust.example/book']);
    expect(urls('"checker borrow"')).toEqual([]);
    expect(urls('"core ideas"')).toEqual(['https://rust.example/book']);
    expect(urls('"ownership and borrowing"')).toEqual(['https://rust.example/book']);
  });
  it('exclusions', () => {
    expect(urls('programming')).toEqual(expect.arrayContaining(['https://rust.example/book', 'https://docs.example/python']));
    expect(urls('programming -rust')).toEqual(['https://docs.example/python']);
    expect(urls('programming -"memory safety"')).toEqual(['https://docs.example/python']);
  });
  it('no results, empty and whitespace queries, punctuation-only', () => {
    expect(urls('zzzzqqqq')).toEqual([]);
    expect(search('')).toMatchObject({ results: [], suggestions: [] });
    expect(urls('   \t ')).toEqual([]);
    expect(urls('!!! ???')).toEqual([]);
    expect(urls('-rust')).toEqual([]); // exclusions alone are not a query
  });
  it('multiple terms across title and body', () => {
    expect(urls('rust ownership')).toEqual(['https://rust.example/book']);
  });
  it('results carry source tier, flags, timestamp, highlights and a content snippet', () => {
    const r = search('borrow').results[0];
    expect(r).toMatchObject({ kind: 'page', url: 'https://rust.example/book', source: 'deep', matchKind: 'content', timestamp: NOW - 2 * DAY, visitCount: 5 });
    expect(r?.flags).toEqual({ history: true, content: true, saved: false });
    expect(r?.snippet?.text.toLowerCase()).toContain('borrow');
    const t = search('rust').results.find((x) => x.url === 'https://rust.example/crates');
    expect(t).toMatchObject({ source: 'history', matchKind: 'title-url' });
    expect(t?.titleHighlights).toEqual([]);
    const th = search('crates').results[0];
    expect(th?.titleHighlights).toEqual([[0, 6]]);
  });
});

describe('Greek and accent folding (A2)', () => {
  beforeEach(seed);
  it('accent-less query finds accented title and body text, and vice versa, in any case', () => {
    for (const q of ['βιβλιο', 'βιβλίο', 'ΒΙΒΛΊΟ', 'Βιβλιο']) expect(urls(q), q).toContain('https://blog.example/greek');
    for (const q of ['αθηνα', 'Αθήνα', 'ΑΘΗΝΑ']) expect(urls(q), q).toEqual(['https://blog.example/greek']);
    expect(urls('ζαχαρωτα')).toEqual(['https://blog.example/greek']);
    expect(urls('λογος')).toEqual(['https://blog.example/greek2']);
    expect(urls('Σωκράτη')).toEqual(['https://blog.example/greek2']);
  });
  it('Greek prefix (>= 3 chars) reaches inflections; there is no stemming (documented limit)', () => {
    expect(urls('βιβλ')).toEqual(['https://blog.example/greek']);
    expect(urls('βιβλια')).toEqual([]);
  });
  it('Greek snippet keeps the original accents and case', () => {
    const r = search('ζαχαρωτα').results[0];
    expect(r?.snippet?.text).toContain('ΖΑΧΑΡΩΤΑ');
    const [a, b] = r?.snippet?.highlights[0] ?? [0, 0];
    expect(r?.snippet?.text.slice(a, b)).toBe('ΖΑΧΑΡΩΤΑ');
  });
  it('Latin accents fold too', () => {
    store.upsertHistory([hist('https://x.example/cafe', 'Café Zürich')]);
    expect(urls('cafe zurich')).toEqual(['https://x.example/cafe']);
    expect(urls('CAFÉ')).toEqual(['https://x.example/cafe']);
  });
  it('title/URL substring fallback is accent-insensitive', () => {
    expect(search('ιβλι').results.some((r) => r.url === 'https://blog.example/greek' && r.approximate)).toBe(true); // relaxation via trigram on "Βιβλίο"
  });
});

describe('filters', () => {
  beforeEach(seed);
  it('site: includes subdomains but not look-alikes; -site: excludes', () => {
    store.upsertHistory([hist('https://notnews.example/', 'Lookalike news')]);
    expect(urls('news site:news.example').sort()).toEqual(['https://news.example/a', 'https://sub.news.example/b']);
    expect(urls('news -site:news.example')).toEqual(['https://notnews.example/']);
    expect(urls('site:rust.example').sort()).toEqual(['https://rust.example/book', 'https://rust.example/crates']);
  });
  it('after: / before: / when: on last visit', () => {
    expect(urls('news after:1d')).toEqual(['https://news.example/a']);
    expect(urls('news before:7d')).toEqual(['https://sub.news.example/b']);
    expect(urls('rust after:2026-09-30 before:2026-10-02')).toEqual(['https://rust.example/book']);
    expect(urls('when:today')).toEqual(['https://news.example/a']);
    expect(urls('when:yesterday')).toEqual([]);
    expect(urls('python when:week')).toEqual(['https://docs.example/python']);
  });
  it('filter-only queries list by recency', () => {
    expect(urls('site:blog.example')).toEqual(['https://blog.example/greek', 'https://blog.example/greek2']);
    expect(search('site:blog.example').results[0]?.matchKind).toBe('filter');
  });
  it('is:saved / is:snippet and the timezone offset on when:today', () => {
    store.savePage({ url: 'https://docs.example/python', title: 'Python Tutorial', body: 'saved python', savedAt: NOW });
    store.addSnippet({ url: 'https://docs.example/python', pageTitle: 'Python Tutorial', text: 'python indentation matters', createdAt: NOW });
    expect(urls('python is:saved')).toEqual(['https://docs.example/python']);
    expect(search('indentation is:snippet').results.map((r) => r.kind)).toEqual(['snippet']);
    expect(search('python').results.filter((r) => !r.approximate).map((r) => r.kind).sort()).toEqual(['page', 'snippet']);
    // at 23:00 UTC+3 on Oct 3 (= 20:00Z) a visit at 22:00Z Oct 2 is "yesterday" in UTC but "today" in Athens
    const late = Date.UTC(2026, 9, 3, 20);
    store.upsertHistory([{ url: 'https://tz.example/', title: 'tz', lastVisitTime: Date.UTC(2026, 9, 2, 22) }]);
    expect(store.search({ query: 'tz when:today', now: late, tzOffsetMinutes: 0 }).results).toHaveLength(0);
    expect(store.search({ query: 'tz when:today', now: late, tzOffsetMinutes: 180 }).results).toHaveLength(1);
  });
  it('reports the interpreted filters for chips', () => {
    expect(search('x site:a.example -site:b.example is:saved after:2026-09-01').filters).toMatchObject({ sites: ['a.example'], excludeSites: ['b.example'], isSaved: true, after: Date.UTC(2026, 8, 1) });
  });
});

describe('ranking order and determinism', () => {
  it('title match beats body-only match; saved and recent and frequent items are boosted', () => {
    store.upsertHistory([hist('https://t.example/title', 'Quantum gardening guide', 30), hist('https://t.example/body', 'Misc notes', 30)]);
    store.upsertContent(content('https://t.example/body', 'a long discussion about quantum gardening techniques and soil'));
    expect(urls('quantum gardening')[0]).toBe('https://t.example/title');
    store.upsertHistory([hist('https://r.example/old', 'Pasta recipe', 200), hist('https://r.example/new', 'Pasta recipe', 1)]);
    expect(urls('pasta recipe')).toEqual(['https://r.example/new', 'https://r.example/old']);
    store.upsertHistory([hist('https://v.example/rare', 'Bicycle repair', 5, { visitCount: 1 }), hist('https://v.example/often', 'Bicycle repair', 5, { visitCount: 40 })]);
    expect(urls('bicycle repair')).toEqual(['https://v.example/often', 'https://v.example/rare']);
    store.savePage({ url: 'https://s.example/saved', title: 'Telescope mirror', body: 'grinding', savedAt: NOW });
    store.upsertHistory([hist('https://s.example/plain', 'Telescope mirror', 0)]);
    expect(urls('telescope mirror')[0]).toBe('https://s.example/saved');
  });
  it('identical scores resolve deterministically (recency, then URL), and repeated searches are identical', () => {
    store.upsertHistory([hist('https://z.example/b', 'Same title', 3), hist('https://z.example/a', 'Same title', 3), hist('https://z.example/c', 'Same title', 3)]);
    expect(urls('same title')).toEqual(['https://z.example/a', 'https://z.example/b', 'https://z.example/c']);
    const strip = (r: ReturnType<typeof search>) => ({ ...r, tookMs: 0 });
    expect(strip(search('same title'))).toEqual(strip(search('same title')));
  });
  it('respects limit and caps it at 200', () => {
    store.upsertHistory(Array.from({ length: 300 }, (_, i) => hist(`https://l.example/${i}`, `common title ${i}`, i % 50)));
    expect(search('common', { limit: 10 }).results).toHaveLength(10);
    expect(search('common', { limit: 200 }).results).toHaveLength(200);
  });
});

describe('relaxation and suggestions', () => {
  beforeEach(seed);
  it('falls back to any-term matching (approximate, after exact results) when exact results are few', () => {
    const r = search('rust gardening').results;
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.approximate)).toBe(true);
    const mixed = search('python programming').results;
    expect(mixed[0]?.approximate).toBe(false);
  });
  it('substring fallback on titles/URLs finds partial words', () => {
    const r = search('ramming lang').results;
    expect(r.some((x) => x.url === 'https://rust.example/book' && x.approximate)).toBe(true);
  });
  it('suggests the closest indexed word for a misspelled term', () => {
    const resp = search('pythn');
    expect(resp.suggestions).toEqual([{ term: 'pythn', replacement: 'python' }]);
    expect(store.suggest('owenrship')).toEqual(['ownership']);
    expect(store.suggest('python')).toEqual([]); // existing words need no suggestion
  });
  it('relaxation never ignores filters', () => {
    expect(urls('rust gardening site:docs.example')).toEqual([]);
  });
});

describe('hostile and odd input never breaks the query', () => {
  beforeEach(seed);
  const odd = ['"', '""', '"""', "'; DROP TABLE pages; --", "' OR 1=1 --", 'a AND OR NOT', 'NEAR(a b, 2)', '*', '**', 'title:rust', 'col:x', '(((', ')))', '\\', '%_', '\u0000', 'x'.repeat(900), '🙂 emoji 🙃', '-', '--', '- -', '"unterminated', 'site:', 'after:', 'is:', '-"', 'a'.repeat(3) + '*', '{ } [ ]', '^', 'rust AND python', 'rust OR python', 'NOT rust'];
  for (const q of odd) {
    it(`does not throw or corrupt: ${JSON.stringify(q).slice(0, 30)}`, () => {
      expect(() => search(q)).not.toThrow();
      expect(store.stats().pages).toBe(7);
    });
  }
  it('FTS keywords are plain words, not operators', () => {
    expect(urls('rust OR python')).toEqual([]); // AND of "rust", "or", "python" — no page contains all three
    expect(urls('NOT rust')).toEqual([]);
  });
  it('very long content and Unicode content are searchable', () => {
    store.upsertContent(content('https://long.example/', `${'padding '.repeat(5000)} 日本語のテキスト 🙂 needle${'x'.repeat(10)}`));
    expect(urls('日本語のテキスト')).toEqual(['https://long.example/']);
    expect(urls('needlexxxxxxxxxx')).toEqual(['https://long.example/']);
  });
});
