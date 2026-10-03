// Headless engine benchmark (Node, in-memory sqlite-wasm + MiniSearch). Complements the in-Chromium run
// (spikes/browser) which is the authoritative measurement for cold-start / OPFS / memory.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import MiniSearch from 'minisearch';
import { generateCorpus, generateQueries, percentile } from '../shared/corpus';
import { FtsStore, type Db, type SchemaOpts } from './fts-store';

const sizes = (process.argv[2] ?? '5000,20000,50000').split(',').map(Number);
const sqlite3 = await sqlite3InitModule();
console.log('SQLite', sqlite3.version.libVersion);

const opts = sqlite3.capi.sqlite3_compileoption_used('ENABLE_FTS5');
console.log('ENABLE_FTS5 compile option:', opts);

const variants: { name: string; schema: SchemaOpts }[] = [
  { name: 'prefix-2-3', schema: { prefix: '2 3' } },
  { name: 'no-prefix-index', schema: { prefix: '' } },
];

for (const n of sizes) {
  const docs = generateCorpus({ pages: n });
  const textBytes = docs.reduce((a, d) => a + d.body.length + d.title.length, 0);
  const qSets = {
    distinctive: generateQueries(docs, 300, 7, 'distinctive'),
    frequency: generateQueries(docs, 300, 8, 'frequency'),
  };
  for (const v of variants) {
    const db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
    const store = new FtsStore(db, v.schema);
    const t = performance.now();
    store.insertAll(docs);
    const insertMs = performance.now() - t;
    const dbBytes = Number(db.selectValue('SELECT page_count*page_size FROM pragma_page_count(), pragma_page_size()'));
    const lat = (queries: string[], opt: { domain?: string; after?: number }, snip: 'ts' | 'fts5' = 'ts') => {
      const xs: number[] = [];
      for (const q of queries) {
        const t0 = performance.now();
        const hits = store.search(q, opt);
        const ids = hits.slice(0, 50).map((h) => h.id);
        if (snip === 'fts5') store.snippets(q, ids);
        else store.snippetsTs(q, ids);
        xs.push(performance.now() - t0);
      }
      xs.sort((a, b) => a - b);
      return { p50: +percentile(xs, 50).toFixed(1), p95: +percentile(xs, 95).toFixed(1), max: +xs[xs.length - 1].toFixed(1) };
    };
    const filt = { domain: docs[0].domain, after: Date.UTC(2026, 3, 1) };
    console.log(JSON.stringify({ engine: 'fts5', variant: v.name, pages: n, textMB: +(textBytes / 1e6).toFixed(1), dbMB: +(dbBytes / 1e6).toFixed(1), dbOverText: +(dbBytes / textBytes).toFixed(2), insertPagesPerSec: Math.round(n / (insertMs / 1000)), distinctive: lat(qSets.distinctive, {}), distinctiveFiltered: lat(qSets.distinctive, filt), frequency: lat(qSets.frequency, {}) }));
    db.close();
  }

  const mem0 = process.memoryUsage().heapUsed;
  const t = performance.now();
  const ms = new MiniSearch({ fields: ['title', 'body'], storeFields: ['url'], searchOptions: { prefix: true, boost: { title: 5 } } });
  ms.addAll(docs.map((d) => ({ id: d.id, title: d.title, body: d.body, url: d.url })));
  const buildMs = performance.now() - t;
  const heapMB = (process.memoryUsage().heapUsed - mem0) / 1e6;
  const res: Record<string, unknown> = {};
  for (const [k, queries] of Object.entries(qSets)) {
    const xs: number[] = [];
    for (const q of queries) {
      const t0 = performance.now();
      ms.search(q, { combineWith: 'AND' });
      xs.push(performance.now() - t0);
    }
    xs.sort((a, b) => a - b);
    res[k] = { p50: +percentile(xs, 50).toFixed(1), p95: +percentile(xs, 95).toFixed(1), max: +xs[xs.length - 1].toFixed(1) };
  }
  console.log(JSON.stringify({ engine: 'minisearch', pages: n, buildMs: Math.round(buildMs), heapDeltaMB: +heapMB.toFixed(0), ...res }));
}
