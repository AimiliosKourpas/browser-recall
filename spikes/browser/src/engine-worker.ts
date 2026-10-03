// Dedicated worker hosted by the offscreen document. Single owner of the database (ARCHITECTURE §2.2).
/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import MiniSearch from 'minisearch';
import { generateCorpus, generateQueries, percentile, type Doc } from '../../shared/corpus';
import { FtsStore, type Db } from '../../engine/fts-store';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
let sqlite3: Sqlite3 | undefined;
let db: (Db & { filename?: string }) | undefined;
let store: FtsStore | undefined;
let pool: { unlink(name: string): boolean; getFileCount(): number; wipeFiles(): Promise<void> } | undefined;
let lastCorpus: Doc[] = [];
let ms: MiniSearch | undefined;

const t = () => performance.now();
const lat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: +percentile(s, 50).toFixed(2), p95: +percentile(s, 95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

async function ensureSqlite(): Promise<Sqlite3> {
  if (!sqlite3) sqlite3 = await (sqlite3InitModule as unknown as (o: unknown) => Promise<Sqlite3>)({ locateFile: (f: string) => new URL(f, self.location.href).href });
  return sqlite3;
}

const handlers: Record<string, (a: Record<string, unknown>) => Promise<unknown> | unknown> = {
  async open(a) {
    const t0 = t();
    const s = await ensureSqlite();
    const t1 = t();
    const vfs = (a.vfs as string) ?? 'opfs-sahpool';
    const file = (a.file as string) ?? '/bench.db';
    let attempts = 0;
    if (vfs === 'memory') {
      db = new s.oo1.DB(':memory:', 'c') as unknown as Db;
    } else {
      // After an abrupt offscreen close the previous worker may still hold the sync access handles for a moment:
      // retry with a short backoff (measured in spikes/browser/resilience.mjs).
      for (attempts = 1; ; attempts++) {
        try {
          pool = (await s.installOpfsSAHPoolVfs({ name: 'br-spike', directory: '/br-spike', clearOnInit: false, forceReinitIfPreviouslyFailed: true } as never)) as never;
          break;
        } catch (e) {
          if (attempts >= 100 || !/NoModificationAllowed|Access Handle/i.test(String(e))) throw e;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const P = pool as unknown as { OpfsSAHPoolDb: new (f: string) => Db };
      db = new P.OpfsSAHPoolDb(file);
    }
    const t2 = t();
    store = new FtsStore(db);
    const t3 = t();
    return {
      wasmInitMs: +(t1 - t0).toFixed(1),
      openMs: +(t2 - t1).toFixed(1),
      schemaMs: +(t3 - t2).toFixed(1),
      totalMs: +(t3 - t0).toFixed(1),
      sqlite: s.version.libVersion,
      fts5: s.capi.sqlite3_compileoption_used('ENABLE_FTS5'),
      vfs,
      attempts,
      pages: store.count(),
    };
  },
  close() {
    db?.close();
    db = undefined;
    store = undefined;
    return true;
  },
  async wipe() {
    store = undefined;
    db?.close();
    db = undefined;
    if (pool) await pool.wipeFiles();
    return true;
  },
  load(a) {
    const pages = a.pages as number;
    const t0 = t();
    lastCorpus = generateCorpus({ pages, seed: (a.seed as number) ?? 42 });
    const genMs = t() - t0;
    const textBytes = lastCorpus.reduce((x, d) => x + d.body.length + d.title.length, 0);
    const t1 = t();
    store!.insertAll(lastCorpus);
    const insertMs = t() - t1;
    return { pages, genMs: Math.round(genMs), insertMs: Math.round(insertMs), insertPagesPerSec: Math.round(pages / (insertMs / 1000)), textMB: +(textBytes / 1e6).toFixed(1), ...dbSize() };
  },
  query(a) {
    const t0 = t();
    const hits = store!.search(a.q as string, {});
    const top = hits.slice(0, 50);
    const sn = store!.snippetsTs(a.q as string, top.map((h) => h.id));
    return { ms: +(t() - t0).toFixed(2), hits: hits.length, top: top.slice(0, 10), snippets: sn.slice(0, 3) };
  },
  bench(a) {
    const mode = (a.mode as 'distinctive' | 'frequency') ?? 'distinctive';
    if (lastCorpus.length === 0) lastCorpus = generateCorpus({ pages: store!.count(), seed: 42 });
    const queries = generateQueries(lastCorpus, (a.n as number) ?? 300, 7, mode);
    const filt = a.filtered ? { domain: lastCorpus[0].domain, after: Date.UTC(2026, 3, 1) } : {};
    const xs: number[] = [];
    for (const q of queries) {
      const t0 = t();
      const hits = store!.search(q, filt);
      const ids = hits.slice(0, 50).map((h) => h.id);
      if (a.snippet === 'fts5') store!.snippets(q, ids);
      else store!.snippetsTs(q, ids);
      xs.push(t() - t0);
    }
    return { mode, filtered: !!a.filtered, ...lat(xs) };
  },
  /** Query benchmark that samples query words from the DB itself, so no corpus is held in memory (used for memory measurements). */
  benchFromDb(a) {
    const n = (a.n as number) ?? 300;
    const rows = db!.selectArrays('SELECT body FROM contents WHERE id IN (SELECT id FROM pages ORDER BY random() LIMIT ?)', [n]);
    const xs: number[] = [];
    for (const r of rows) {
      const words = String(r[0]).slice(0, 4000).split(' ').filter((w) => w.length >= 5);
      const q = `${words[Math.floor(Math.random() * words.length)]} ${words[Math.floor(Math.random() * words.length)]?.slice(0, 4)}`;
      const t0 = t();
      const hits = store!.search(q, {});
      store!.snippetsTs(q, hits.slice(0, 50).map((h) => h.id));
      xs.push(t() - t0);
    }
    return lat(xs);
  },
  dbsize: () => dbSize(),
  integrity() {
    const ic = db!.selectArrays('PRAGMA integrity_check').map((r) => r[0]);
    let fts = 'ok';
    try {
      db!.exec("INSERT INTO fts_main(fts_main) VALUES('integrity-check')");
    } catch (e) {
      fts = String(e);
    }
    return { integrity: ic, fts, pages: store!.count() };
  },
  consistency() {
    const n = (sql: string) => Number(db!.selectValue(sql));
    const pages = n('SELECT count(*) FROM pages');
    const contents = n('SELECT count(*) FROM contents');
    const meta = n('SELECT count(*) FROM fts_meta');
    let fts = 'ok';
    try {
      db!.exec("INSERT INTO fts_main(fts_main) VALUES('integrity-check')");
    } catch (e) {
      fts = String(e);
    }
    const ic = db!.selectArrays('PRAGMA integrity_check').map((r) => r[0]);
    return { pages, contents, meta, consistent: pages === contents && pages === meta, ftsIntegrity: fts, sqliteIntegrity: ic };
  },
  /** Live-index simulation for the soak: insert `n` fresh pages with new ids, then delete the `n` oldest. */
  churn(a) {
    const n = (a.n as number) ?? 20;
    const base = Number(db!.selectValue('SELECT COALESCE(MAX(id),0) FROM pages')) + 1;
    const docs = generateCorpus({ pages: n, seed: base }).map((d, i) => ({ ...d, id: base + i, url: `${d.url}?c=${base + i}` }));
    store!.insertAll(docs, 20);
    let deleted = 0;
    if (a.deleteOld) {
      const ids = db!.selectArrays('SELECT id FROM pages ORDER BY id LIMIT ?', [n]).map((r) => r[0] as number);
      db!.transaction(() => {
        for (const id of ids) {
          db!.exec({ sql: 'DELETE FROM fts_main WHERE rowid=?', bind: [id] }); // contentless_delete=1
          db!.exec({ sql: 'DELETE FROM fts_meta WHERE rowid=?', bind: [id] });
          db!.exec({ sql: 'DELETE FROM contents WHERE id=?', bind: [id] });
          db!.exec({ sql: 'DELETE FROM pages WHERE id=?', bind: [id] });
          deleted++;
        }
      });
    }
    return { inserted: n, deleted, pages: store!.count() };
  },
  insertRows(a) {
    const rows = a.rows as { url: string; title: string; lastVisitTime: number; visitCount: number }[];
    const base = Number(db!.selectValue('SELECT COALESCE(MAX(id),0) FROM pages')) + 1;
    const docs: Doc[] = rows.map((r, i) => ({ id: base + i, url: r.url, domain: new URL(r.url).hostname, title: r.title, body: '', lastVisit: r.lastVisitTime, visitCount: r.visitCount }));
    const t0 = t();
    store!.insertAll(docs, 250);
    return { n: rows.length, ms: Math.round(t() - t0) };
  },
  async netprobe(a) {
    // Fires a no-cors fetch at a local recorder; with connect-src 'none' it must never leave the worker.
    try {
      await fetch(a.url as string, { mode: 'no-cors' });
      return 'sent';
    } catch (e) {
      return `blocked: ${(e as Error).message}`;
    }
  },
  mem() {
    const pm = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    const heap = sqlite3 ? sqlite3.wasm.heap8().length : 0;
    return { jsHeapMB: pm ? +(pm.usedJSHeapSize / 1e6).toFixed(1) : null, wasmHeapMB: +(heap / 1e6).toFixed(1) };
  },
  // ---- MiniSearch fallback measurements (in the same worker, for apples-to-apples) ----
  msBuild(a) {
    const docs = generateCorpus({ pages: a.pages as number, seed: 42 });
    lastCorpus = docs;
    const t0 = t();
    ms = new MiniSearch({ fields: ['title', 'body'], storeFields: ['url'], searchOptions: { prefix: true, boost: { title: 5 }, combineWith: 'AND' } });
    ms.addAll(docs.map((d) => ({ id: d.id, title: d.title, body: d.body, url: d.url })));
    const buildMs = t() - t0;
    return { pages: a.pages, buildMs: Math.round(buildMs) };
  },
  msBench(a) {
    const mode = (a.mode as 'distinctive' | 'frequency') ?? 'distinctive';
    const queries = generateQueries(lastCorpus, 300, 7, mode);
    const xs: number[] = [];
    for (const q of queries) {
      const t0 = t();
      ms!.search(q);
      xs.push(t() - t0);
    }
    return { mode, ...lat(xs) };
  },
  msColdStart() {
    // cold start of the fallback = serialise-to-disk then JSON.parse + loadJSON on every wake-up
    const t0 = t();
    const json = JSON.stringify(ms!.toJSON());
    const serMs = t() - t0;
    const t1 = t();
    const loaded = MiniSearch.loadJSON(json, { fields: ['title', 'body'], storeFields: ['url'] });
    const loadMs = t() - t1;
    void loaded;
    return { serializedMB: +(json.length / 1e6).toFixed(1), serializeMs: Math.round(serMs), loadJsonMs: Math.round(loadMs) };
  },
  msFree() {
    ms = undefined;
    return true;
  },
};

function dbSize() {
  const pageCount = Number(db!.selectValue('PRAGMA page_count'));
  const pageSize = Number(db!.selectValue('PRAGMA page_size'));
  return { dbMB: +((pageCount * pageSize) / 1e6).toFixed(1), dbBytes: pageCount * pageSize };
}

self.onmessage = async (e: MessageEvent) => {
  const { id, cmd, args } = e.data as { id: number; cmd: string; args: Record<string, unknown> };
  try {
    const h = handlers[cmd];
    if (!h) throw new Error(`unknown cmd ${cmd}`);
    const result = await h(args ?? {});
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.stack ?? err) });
  }
};
(self as unknown as Worker).postMessage({ ready: true });
