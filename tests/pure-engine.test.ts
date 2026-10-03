import { describe, expect, it } from 'vitest';
import { fold, foldWithMap, tokenize } from '../src/engine/fold';
import { normalizeUrl } from '../src/engine/url';
import { parseDateValue, parseWhen, startOfDay } from '../src/engine/search/dates';
import { parseQuery } from '../src/engine/search/parser';
import { buildAnyMatch, buildExcludeMatch, buildMatch, buildTrigramMatch } from '../src/engine/search/match';
import { editDistance } from '../src/engine/search/edit-distance';
import { WEIGHTS, combine, normalizeBm25, phraseHit, recency, titleUrlHit, visitBoost } from '../src/engine/search/ranking';
import { buildSnippet, highlightRanges } from '../src/engine/search/snippet';

const NOW = Date.UTC(2026, 9, 3, 12);
const DAY = 86_400_000;
const ctx = { now: NOW };

describe('fold (A2)', () => {
  it('NFD → strip marks → lowercase: Greek tonos, dialytika, Latin accents, final sigma, case', () => {
    expect(fold('Βιβλίο')).toBe('βιβλιο');
    expect(fold('ΒΙΒΛΊΟ')).toBe('βιβλιο');
    expect(fold('λόγος')).toBe('λογοσ');
    expect(fold('ΛΟΓΟΣ')).toBe('λογοσ'); // final sigma folds to sigma: context-free, so per-character folding (snippets) agrees with whole-string folding
    expect(foldWithMap('ΛΟΓΟΣ').text).toBe('λογοσ');
    expect(fold('ΐ ΰ ϊ ϋ ά έ ή ί ό ύ ώ')).toBe('ι υ ι υ α ε η ι ο υ ω');
    expect(fold('Café Zürich Ñandú Ångström')).toBe('cafe zurich nandu angstrom');
  });
  it('is idempotent and leaves non-letters alone', () => {
    const s = 'Ελλάδα 2026 — 日本語 #x';
    expect(fold(fold(s))).toBe(fold(s));
    expect(fold('日本語')).toBe('日本語');
  });
  it('foldWithMap maps folded offsets back to the original (accents, expansion-free)', () => {
    const o = 'Ο Άνθρωπος';
    const { text, map } = foldWithMap(o);
    expect(text).toBe('ο ανθρωποσ');
    expect(o.slice(map[text.indexOf('ανθρωποσ')], map[text.length])).toBe('Άνθρωπος');
  });
  it('tokenize splits on non-letters/numbers', () => {
    expect(tokenize(fold("Foo-bar_baz, C++ 42!"))).toEqual(['foo', 'bar', 'baz', 'c', '42']);
  });
});

describe('normalizeUrl (A6)', () => {
  it('http(s) only', () => {
    // eslint-disable-next-line no-script-url -- the URL under test is data, never executed
    for (const bad of ['chrome://settings', 'chrome-extension://a/b.html', 'file:///x', 'about:blank', 'data:text/plain,x', 'blob:https://a/b', 'javascript:alert(1)', 'view-source:https://a.com', 'ftp://a.com/x', '', 'nope']) expect(normalizeUrl(bad), bad).toBeUndefined();
    expect(normalizeUrl('https://A.Example/Path?q=1#h')).toEqual({ url: 'https://a.example/Path?q=1', domain: 'a.example' });
  });
  it('strips fragments, credentials and tracking params, keeps real params in order', () => {
    expect(normalizeUrl('https://u:p@a.example/x?b=2&utm_source=n&a=1&fbclid=zz&gclid=1#frag')?.url).toBe('https://a.example/x?b=2&a=1');
    expect(normalizeUrl('https://a.example/x?utm_medium=1')?.url).toBe('https://a.example/x');
    expect(normalizeUrl('https://a.example:443/x')?.url).toBe('https://a.example/x');
  });
  it('rejects over-long URLs', () => {
    expect(normalizeUrl(`https://a.example/${'x'.repeat(2100)}`)).toBeUndefined();
  });
});

describe('dates', () => {
  it('ISO dates at local day start, with timezone offset; invalid dates rejected', () => {
    expect(parseDateValue('2026-09-01', ctx)).toBe(Date.UTC(2026, 8, 1));
    expect(parseDateValue('2026-09-01', { now: NOW, tzOffsetMinutes: 180 })).toBe(Date.UTC(2026, 8, 1) - 3 * 3_600_000);
    for (const bad of ['2026-02-30', '2026-13-01', '26-09-01', 'yesterday', '', '7', 'd7', '7x']) expect(parseDateValue(bad, ctx), bad).toBeUndefined();
  });
  it('relative d / w / m / y', () => {
    expect(parseDateValue('7d', ctx)).toBe(NOW - 7 * DAY);
    expect(parseDateValue('2w', ctx)).toBe(NOW - 14 * DAY);
    expect(parseDateValue('3m', ctx)).toBe(NOW - 90 * DAY);
    expect(parseDateValue('1Y', ctx)).toBe(NOW - 365 * DAY);
  });
  it('when presets', () => {
    const today = startOfDay(NOW);
    expect(parseWhen('today', ctx)).toEqual({ after: today });
    expect(parseWhen('yesterday', ctx)).toEqual({ after: today - DAY, before: today });
    expect(parseWhen('week', ctx)).toEqual({ after: NOW - 7 * DAY });
    expect(parseWhen('month', ctx)).toEqual({ after: NOW - 30 * DAY });
    expect(parseWhen('YEAR', ctx)).toEqual({ after: NOW - 365 * DAY });
    expect(parseWhen('decade', ctx)).toBeUndefined();
  });
  it('startOfDay respects the offset', () => {
    expect(startOfDay(Date.UTC(2026, 9, 3, 22), 180)).toBe(Date.UTC(2026, 9, 4) - 3 * 3_600_000);
  });
});

describe('query parser: every documented syntax form', () => {
  const p = (s: string) => parseQuery(s, ctx);
  it('words, all required; folded', () => {
    expect(p('Βιβλίο  Café').positives).toEqual([{ tokens: ['βιβλιο'], quoted: false }, { tokens: ['cafe'], quoted: false }]);
  });
  it('"exact phrase" and an unterminated quote', () => {
    expect(p('"hello big world" x').positives).toEqual([{ tokens: ['hello', 'big', 'world'], quoted: true }, { tokens: ['x'], quoted: false }]);
    expect(p('say "unclosed phrase here').positives).toEqual([{ tokens: ['say'], quoted: false }, { tokens: ['unclosed', 'phrase', 'here'], quoted: true }]);
  });
  it('-word and -"phrase" exclusions; a lone "-" is punctuation', () => {
    const q = p('apple -pie -"green tea" - x');
    expect(q.positives.map((x) => x.tokens[0])).toEqual(['apple', 'x']);
    expect(q.excludes).toEqual([['pie'], ['green', 'tea']]);
  });
  it('site: and -site: (subdomains handled by the store), www stripped, invalid domains become literal text', () => {
    const q = p('site:Example.com -site:www.bad.org site:nope');
    expect(q.sites).toEqual(['example.com']);
    expect(q.excludeSites).toEqual(['bad.org']);
    expect(q.positives).toEqual([{ tokens: ['site', 'nope'], quoted: false }]);
  });
  it('after: / before: with ISO and relative values; invalid → literal', () => {
    const q = p('after:2026-09-01 before:2026-09-30 x');
    expect(q.after).toBe(Date.UTC(2026, 8, 1));
    expect(q.before).toBe(Date.UTC(2026, 8, 30));
    expect(p('after:7d').after).toBe(NOW - 7 * DAY);
    expect(p('after:2w').after).toBe(NOW - 14 * DAY);
    expect(p('after:3m').after).toBe(NOW - 90 * DAY);
    expect(p('after:soon').positives).toEqual([{ tokens: ['after', 'soon'], quoted: false }]);
    expect(p('-after:7d').after).toBeUndefined();
  });
  it('when: presets', () => {
    expect(p('when:today').after).toBe(startOfDay(NOW));
    expect(p('when:yesterday')).toMatchObject({ after: startOfDay(NOW) - DAY, before: startOfDay(NOW) });
    expect(p('when:week').after).toBe(NOW - 7 * DAY);
    expect(p('when:month').after).toBe(NOW - 30 * DAY);
    expect(p('when:year').after).toBe(NOW - 365 * DAY);
    expect(p('when:never').positives).toHaveLength(1);
  });
  it('is:saved / is:snippet (case-insensitive keys); unknown is: values are literal', () => {
    expect(p('IS:Saved x')).toMatchObject({ isSaved: true, isSnippet: false });
    expect(p('is:snippet')).toMatchObject({ isSnippet: true });
    expect(p('is:unread').positives).toEqual([{ tokens: ['is', 'unread'], quoted: false }]);
  });
  it('unknown operators and operators inside quotes are literal text', () => {
    expect(p('foo:bar').positives).toEqual([{ tokens: ['foo', 'bar'], quoted: false }]);
    expect(p('"site:example.com"').sites).toEqual([]);
  });
  it('words with punctuation become multi-token phrases; pure punctuation vanishes', () => {
    expect(p('foo-bar').positives).toEqual([{ tokens: ['foo', 'bar'], quoted: false }]);
    expect(p('!!! ... ---').positives).toEqual([]);
  });
  it('empty and whitespace-only input', () => {
    expect(p('')).toMatchObject({ positives: [], excludes: [], sites: [] });
    expect(p('   \t\n ').positives).toEqual([]);
  });
});

describe('FTS match builder (closed grammar)', () => {
  it('ANDs positives, last bare word is a prefix, quoted phrase is not', () => {
    expect(buildMatch(parseQuery('alpha beta', ctx).positives)).toBe('"alpha" "beta"*');
    expect(buildMatch(parseQuery('alpha "beta gamma"', ctx).positives)).toBe('"alpha" "beta gamma"');
    expect(buildMatch(parseQuery('foo-bar', ctx).positives)).toBe('"foo bar"*');
    expect(buildMatch([])).toBeUndefined();
  });
  it('any-match uses distinct tokens of >= 3 characters', () => {
    expect(buildAnyMatch(parseQuery('a to alpha alpha beta', ctx).positives)).toBe('"alpha" OR "beta"');
    expect(buildAnyMatch(parseQuery('a to', ctx).positives)).toBeUndefined();
  });
  it('exclusions and trigram probes', () => {
    expect(buildExcludeMatch(parseQuery('-a -"b c"', ctx).excludes)).toBe('"a" OR "b c"');
    expect(buildExcludeMatch([])).toBeUndefined();
    expect(buildTrigramMatch('ab')).toBeUndefined();
    expect(buildTrigramMatch('héllo wör')).toBe('"héllo wör"');
  });
  it('only letters, digits and spaces survive into the expression, whatever the input', () => {
    const q = parseQuery('"; DROP TABLE pages; -- \' OR 1=1 ) ( * NEAR(a b) col:x', ctx);
    const expr = `${buildMatch(q.positives) ?? ''} ${buildAnyMatch(q.positives) ?? ''}`;
    expect(expr.replace(/"/g, '').replace(/\*|OR/g, '')).toMatch(/^[\p{L}\p{N} ]*$/u);
  });
});

describe('edit distance', () => {
  it('computes small distances and bails out early', () => {
    expect(editDistance('kitten', 'sitting', 5)).toBe(3);
    expect(editDistance('abc', 'abc', 2)).toBe(0);
    expect(editDistance('abc', 'abd', 2)).toBe(1);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
    expect(editDistance('a', 'abcdefgh', 2)).toBe(3);
  });
});

describe('ranking components (each tested on its own)', () => {
  it('normalizeBm25: relative to the best (most negative) → best = 1; near-equal scores stay near-equal; degenerate input → 1', () => {
    expect(normalizeBm25([-10, -5, 0])).toEqual([1, 0.5, 0]);
    expect(normalizeBm25([-3])).toEqual([1]);
    expect(normalizeBm25([-2, -2])).toEqual([1, 1]);
    expect(normalizeBm25([-10, -9.9])[1]).toBeGreaterThan(0.98);
    expect(normalizeBm25([0, 0])).toEqual([1, 1]);
    expect(normalizeBm25([])).toEqual([]);
  });
  it('titleUrlHit: all / some / none, whole word or prefix', () => {
    expect(titleUrlHit(['rust', 'book'], ['the', 'rust', 'book'], [])).toBe(1);
    expect(titleUrlHit(['rust', 'zzz'], ['rust'], [])).toBe(0.5);
    expect(titleUrlHit(['zzz'], ['rust'], ['crates'])).toBe(0);
    expect(titleUrlHit(['cra'], [], ['crates'])).toBe(1);
    expect(titleUrlHit([], ['x'], [])).toBe(0);
  });
  it('recency decays exponentially with tau 45 days and is 1 for the future', () => {
    expect(recency(NOW, NOW)).toBe(1);
    expect(recency(NOW - 45 * DAY, NOW)).toBeCloseTo(Math.exp(-1), 10);
    expect(recency(NOW + DAY, NOW)).toBe(1);
    expect(recency(NOW - 10 * DAY, NOW)).toBeGreaterThan(recency(NOW - 90 * DAY, NOW));
  });
  it('visitBoost is log1p and non-negative', () => {
    expect(visitBoost(0)).toBe(0);
    expect(visitBoost(1)).toBeCloseTo(Math.log(2), 10);
    expect(visitBoost(-5)).toBe(0);
  });
  it('phraseHit needs every multi-token phrase contiguous', () => {
    expect(phraseHit([['quick', 'brown']], 'the quick brown fox')).toBe(1);
    expect(phraseHit([['quick', 'fox']], 'the quick brown fox')).toBe(0);
    expect(phraseHit([['one']], 'one')).toBe(0);
    expect(phraseHit([], 'x')).toBe(0);
  });
  it('combine applies the weights and the saved bonus', () => {
    const base = { bm25Norm: 1, titleUrl: 1, recency: 1, visits: 1, saved: false, phrase: 1 };
    expect(combine(base)).toBeCloseTo(WEIGHTS.bm25 + WEIGHTS.titleUrl + WEIGHTS.recency + WEIGHTS.visits + WEIGHTS.phrase, 10);
    expect(combine({ ...base, saved: true }) - combine(base)).toBeCloseTo(WEIGHTS.saved, 10);
  });
});

describe('snippets (A1: TypeScript, deterministic)', () => {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `lorem${i}`).join(' ');
  it('match near the beginning: no leading ellipsis, highlights point at the match', () => {
    const s = buildSnippet(`Alpha beta gamma ${filler(200)}`, ['beta'], -1);
    expect(s?.text.startsWith('Alpha beta')).toBe(true);
    expect(s?.text.endsWith('…')).toBe(true);
    const [a, b] = s?.highlights[0] ?? [0, 0];
    expect(s?.text.slice(a, b)).toBe('beta');
  });
  it('match deep in the content: leading and trailing ellipsis, context kept, within the length budget', () => {
    const s = buildSnippet(`${filler(300)} needle ${filler(300)}`, ['needle'], -1, { maxLength: 120 });
    expect(s?.text.startsWith('…')).toBe(true);
    expect(s?.text.endsWith('…')).toBe(true);
    expect(s?.text).toContain('needle');
    expect(s?.text.length).toBeLessThanOrEqual(120 + 2 + 2);
    const [a, b] = s?.highlights[0] ?? [0, 0];
    expect(s?.text.slice(a, b)).toBe('needle');
  });
  it('multiple terms: prefers the window that covers the most distinct terms', () => {
    const text = `alpha ${filler(120)} alpha ${filler(5)} beta gamma ${filler(120)}`;
    const s = buildSnippet(text, ['alpha', 'beta', 'gamma'], -1, { maxLength: 150 });
    expect(s?.text).toContain('beta gamma');
    expect(new Set(s?.highlights.map(([a, b]) => s.text.slice(a, b))).size).toBeGreaterThanOrEqual(2);
  });
  it('prefix term matches word starts only for the flagged term', () => {
    const s = buildSnippet('programming is fun; pro tips', ['pro'], 0);
    expect(s?.highlights.map(([a, b]) => s.text.slice(a, b))).toEqual(['programming', 'pro']);
    expect(buildSnippet('programming', ['pro'], -1)).toBeUndefined(); // whole-word only when not a prefix term
  });
  it('missing content or no match → undefined', () => {
    expect(buildSnippet('', ['a'], -1)).toBeUndefined();
    expect(buildSnippet('nothing here', ['zzz'], -1)).toBeUndefined();
    expect(buildSnippet('text', [], -1)).toBeUndefined();
  });
  it('Greek: accent- and case-insensitive match, original accents and case preserved in the output and highlights', () => {
    const s = buildSnippet('Ο Λόγος του Σωκράτη για την ΑΡΕΤΗ', ['λογοσ', 'αρετη'], -1);
    expect(s?.text).toBe('Ο Λόγος του Σωκράτη για την ΑΡΕΤΗ');
    expect(s?.highlights.map(([a, b]) => s.text.slice(a, b))).toEqual(['Λόγος', 'ΑΡΕΤΗ']);
  });
  it('never splits a surrogate pair and collapses whitespace', () => {
    const s = buildSnippet(`${'😀'.repeat(80)} target ${'😀'.repeat(80)}`, ['target'], -1, { maxLength: 40, lead: 10 });
    expect(s?.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(buildSnippet('a   b\n\n c   target', ['target'], -1)?.text).toBe('a b c target');
  });
  it('is deterministic', () => {
    const t = `${filler(100)} needle ${filler(100)}`;
    expect(buildSnippet(t, ['needle'], -1)).toEqual(buildSnippet(t, ['needle'], -1));
  });
  it('highlightRanges for titles', () => {
    expect(highlightRanges('Rust Book: Ownership', ['rust', 'own'], 1)).toEqual([[0, 4], [11, 20]]);
  });
});
