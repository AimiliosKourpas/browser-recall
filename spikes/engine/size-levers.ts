// DB-size vs latency levers at 20K pages: prefix-index sets and page size.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { generateCorpus, generateQueries, percentile } from '../shared/corpus';
import { FtsStore, type Db } from './fts-store';

const n = Number(process.argv[2] ?? 20000);
const sqlite3 = await sqlite3InitModule();
const docs = generateCorpus({ pages: n });
const textBytes = docs.reduce((a, d) => a + d.body.length + d.title.length, 0);
const sets = { distinctive: generateQueries(docs, 300, 7, 'distinctive'), frequency: generateQueries(docs, 300, 8, 'frequency') };
for (const [prefix, pageSize] of [['2 3', 4096], ['3', 4096], ['2', 4096], ['', 4096], ['2 3', 16384], ['3', 16384]] as [string, number][]) {
  const db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
  db.exec(`PRAGMA page_size=${pageSize}`);
  const store = new FtsStore(db, { prefix });
  store.insertAll(docs);
  const bytes = Number(db.selectValue('SELECT page_count*page_size FROM pragma_page_count(), pragma_page_size()'));
  const lat = (qs: string[]) => {
    const xs: number[] = [];
    for (const q of qs) {
      const t = performance.now();
      const ids = store.search(q).slice(0, 50).map((h) => h.id);
      store.snippetsTs(q, ids);
      xs.push(performance.now() - t);
    }
    xs.sort((a, b) => a - b);
    return `p50=${percentile(xs, 50).toFixed(1)} p95=${percentile(xs, 95).toFixed(1)}`;
  };
  console.log(`prefix='${prefix}' page_size=${pageSize}: db=${(bytes / 1e6).toFixed(0)}MB (${(bytes / textBytes).toFixed(2)}x text)  distinctive ${lat(sets.distinctive)}  frequency ${lat(sets.frequency)}`);
  db.close();
}
