// Where does FTS5 query time go at 20K pages? Breaks one query into: candidate retrieval, snippet() pass, and compares levers.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { generateCorpus, generateQueries, percentile } from '../shared/corpus';
import { FtsStore, type Db } from './fts-store';

const n = Number(process.argv[2] ?? 20000);
const sqlite3 = await sqlite3InitModule();
const docs = generateCorpus({ pages: n });
const db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
const store = new FtsStore(db, { legacyExternalContent: true }); // snippet() comparisons need the original external-content design
store.insertAll(docs);
const qs = generateQueries(docs, 300, 7, 'distinctive');
const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `p50=${percentile(s, 50).toFixed(1)} p95=${percentile(s, 95).toFixed(1)} max=${s[s.length - 1].toFixed(1)}`;
};
const time = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

const G: number[] = [], H: number[] = [];
const A: number[] = [], B: number[] = [], C: number[] = [], D: number[] = [], E: number[] = [], F: number[] = [];
const rows: { q: string; hits: number; ms: number }[] = [];
const exactOnly = (q: string) => q.split(/\s+/).filter(Boolean).map((t) => `"${t}"`).join(' ');
for (const q of qs) {
  let hits = 0;
  const m = FtsStore.toMatch(q);
  // A: current pipeline: join pages + bm25 top-200, then snippet() pass for top 50
  A.push(time(() => { const h = store.search(q); hits = h.length; store.snippets(q, h.slice(0, 50).map((x) => x.id)); }));
  // B: candidate retrieval only (join + bm25)
  B.push(time(() => store.search(q)));
  // C: no join with pages (pure FTS5 rank)
  C.push(time(() => db.selectArrays('SELECT rowid FROM fts_main WHERE fts_main MATCH ? ORDER BY rank LIMIT 200', [m])));
  // D: bm25 with explicit weights, no join
  D.push(time(() => db.selectArrays('SELECT rowid, bm25(fts_main,10.0,1.0) s FROM fts_main WHERE fts_main MATCH ? ORDER BY s LIMIT 200', [m])));
  // E: exact terms only (no prefix on last term)
  E.push(time(() => db.selectArrays('SELECT rowid, bm25(fts_main,10.0,1.0) s FROM fts_main WHERE fts_main MATCH ? ORDER BY s LIMIT 200', [exactOnly(q)])));
  // F: just counting matches (lower bound: cost of intersecting doclists)
  F.push(time(() => db.selectValue('SELECT count(*) FROM fts_main WHERE fts_main MATCH ?', [m])));
  // G: snippet() one row at a time with a rowid equality constraint (top 50)
  G.push(time(() => {
    const ids = store.search(q).slice(0, 50).map((x) => x.id);
    const st = db.prepare("SELECT snippet(fts_main, 1, char(1), char(2), '…', 12) FROM fts_main WHERE fts_main MATCH ? AND rowid = ?");
    for (const id of ids) { st.bind([m, id]); st.step(); st.get(0); st.reset(); }
    st.finalize();
  }));
  // H: snippets built in TypeScript from the stored body of the top 50 (ARCHITECTURE §5.5 option)
  H.push(time(() => {
    const ids = store.search(q).slice(0, 50).map((x) => x.id);
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const st = db.prepare('SELECT body FROM contents WHERE id = ?');
    for (const id of ids) {
      st.bind([id]); st.step();
      const body = String(st.get(0)).toLowerCase();
      st.reset();
      let at = -1;
      for (const t of terms) { const i = body.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
      void body.slice(Math.max(0, at - 60), at + 120);
    }
    st.finalize();
  }));
  rows.push({ q, hits, ms: A[A.length - 1] });
}
console.log(`pages=${n}`);
console.log('A current (candidates + snippet pass):', stat(A));
console.log('B candidates only (join pages, bm25):', stat(B));
console.log('C candidates, no join, ORDER BY rank:', stat(C));
console.log('D candidates, no join, explicit bm25:', stat(D));
console.log('E exact terms only (no last-term prefix):', stat(E));
console.log('G candidates + snippet() per row w/ rowid=? (top 50):', stat(G));
console.log('H candidates + TypeScript snippets from stored body (top 50):', stat(H));
console.log('F count(*) of matches only:', stat(F));
rows.sort((a, b) => b.ms - a.ms);
console.log('slowest 5 queries (current pipeline):');
for (const r of rows.slice(0, 5)) console.log(`  ${r.ms.toFixed(0)} ms  hits=${r.hits}  q="${r.q}"`);
const corr = (() => { // fraction of time variance explained by hit count (rough)
  const xs = rows.map((r) => Math.log1p(r.hits)), ys = rows.map((r) => r.ms);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
})();
console.log('corr(log hits, ms) =', corr.toFixed(2));
