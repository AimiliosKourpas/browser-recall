import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/engine/db';
import { fold, tokenize } from '../src/engine/fold';
import { normalizeUrl } from '../src/engine/url';
import { buildAnyMatch, buildExcludeMatch, buildMatch } from '../src/engine/search/match';
import { parseQuery } from '../src/engine/search/parser';
import { buildSnippet } from '../src/engine/search/snippet';
import { SearchStore } from '../src/engine/store';
import { openMemoryDb } from '../src/engine/sqlite';
import { NOW, hist, content } from './helpers/engine';

const ctx = { now: NOW };
const anyText = fc.oneof(fc.string({ maxLength: 60 }), fc.string({ unit: 'binary', maxLength: 60 }), fc.constantFrom('"', "'", '\\', '-', '*', ':', '(', ')', ' ', 'AND', 'OR', 'NOT', 'NEAR', 'site:', 'after:', 'is:', '%', '_').chain((a) => fc.string({ maxLength: 30 }).map((b) => a + b)));
const SAFE_EXPR = /^(?:"[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*"\*?(?: OR | |$))*$/u;

describe('property: the parser is total and the FTS grammar stays closed', () => {
  it('parseQuery never throws and yields only folded alphanumeric tokens, plain domains and finite numbers', () => {
    fc.assert(
      fc.property(anyText, (s) => {
        const q = parseQuery(s, ctx);
        for (const t of [...q.positives.flatMap((p) => p.tokens), ...q.excludes.flat()]) expect(t).toMatch(/^[\p{L}\p{N}]+$/u);
        for (const d of [...q.sites, ...q.excludeSites]) expect(d).toMatch(/^[a-z0-9.-]+$/);
        for (const n of [q.after, q.before]) expect(n === undefined || Number.isFinite(n)).toBe(true);
      }),
      { numRuns: 800 },
    );
  });
  it('every MATCH expression is built from the closed grammar: quoted alphanumeric groups, *, OR, spaces', () => {
    fc.assert(
      fc.property(anyText, (s) => {
        const q = parseQuery(s, ctx);
        for (const expr of [buildMatch(q.positives), buildAnyMatch(q.positives), buildExcludeMatch(q.excludes)]) if (expr) expect(expr).toMatch(SAFE_EXPR);
      }),
      { numRuns: 800 },
    );
  });
  it('fold is idempotent; tokenize output is stable under fold', () => {
    fc.assert(fc.property(fc.string({ maxLength: 80 }), (s) => fold(fold(s)) === fold(s) && tokenize(fold(s)).every((t) => fold(t) === t)), { numRuns: 500 });
  });
  it('normalizeUrl is total, idempotent, and only ever returns http(s) URLs without fragments', () => {
    fc.assert(
      fc.property(fc.oneof(fc.webUrl(), fc.string(), fc.constantFrom('chrome://x', 'file:///a', 'https://a.example/#x')), (s) => {
        const n = normalizeUrl(s);
        if (!n) return;
        expect(n.url).toMatch(/^https?:\/\//);
        expect(n.url).not.toContain('#');
        expect(normalizeUrl(n.url)?.url).toBe(n.url);
      }),
      { numRuns: 500 },
    );
  });
  it('buildSnippet never throws and highlights always point at text inside the snippet', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 3 }), (text, words) => {
        const terms = words.flatMap((w) => tokenize(fold(w)));
        const s = buildSnippet(text, terms, -1);
        if (!s) return;
        for (const [a, b] of s.highlights) expect(a >= 0 && b <= s.text.length && b > a).toBe(true);
      }),
      { numRuns: 400 },
    );
  });
});

describe('property: no user text ever reaches SQL (against the real engine)', () => {
  it('SQL statements never contain the query text; searches never throw; the database is never altered by a search', async () => {
    const real = await openMemoryDb();
    const sqls: string[] = [];
    const spy: Db = {
      exec: (o) => (sqls.push(typeof o === 'string' ? o : o.sql), real.exec(o)),
      prepare: (sql) => (sqls.push(sql), real.prepare(sql)),
      transaction: (cb) => real.transaction(cb),
      selectValue: (sql, bind) => (sqls.push(sql), real.selectValue(sql, bind)),
      selectArrays: (sql, bind) => (sqls.push(sql), real.selectArrays(sql, bind)),
      close: () => real.close(),
    };
    const store = SearchStore.open(spy);
    store.upsertHistory([hist('https://a.example/', 'Marker Page zq7x9')]);
    store.upsertContent(content('https://a.example/', 'body with zq7x9 inside'));
    store.addSnippet({ url: 'https://a.example/', text: 'quote zq7x9', createdAt: NOW });
    const before = JSON.stringify(store.exportData('all', 0));
    sqls.length = 0;
    fc.assert(
      fc.property(anyText, (s) => {
        const q = `zq7x9 ${s}`;
        expect(() => store.search({ query: q, now: NOW })).not.toThrow();
      }),
      { numRuns: 400 },
    );
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) expect(sql).not.toContain('zq7x9');
    // statement shapes are fixed templates: only the site-filter / IN-list arity varies, never text
    expect(new Set(sqls).size).toBeLessThan(60);
    expect(JSON.stringify(store.exportData('all', 0))).toBe(before);
    expect(store.integrityCheck().ok).toBe(true);
  });
});
