// In-Chromium engine benchmark: SQLite FTS5 (opfs-sahpool, offscreen-hosted worker) vs MiniSearch.
// Usage: xvfb-run -a node spikes/browser/bench-engine.mjs 5000,20000,50000
import { launch, extensionIds, benchPage, extensionRssMB, sleep } from './harness.mjs';

const sizes = (process.argv[2] ?? '5000,20000,50000').split(',').map(Number);
const out = (o) => console.log(JSON.stringify(o));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function session(fn) {
  const { ctx } = await launch({ exts: ['base'] });
  try {
    const [id] = await extensionIds(ctx);
    const b = await benchPage(ctx, id);
    await b.sw({ cmd: 'offscreen-ensure' });
    await sleep(500);
    return await fn(b);
  } finally {
    await ctx.close();
  }
}

for (const pages of sizes) {
  // ---------------- FTS5 / opfs-sahpool ----------------
  await session(async (b) => {
    await b.engine('open', { vfs: 'opfs-sahpool' });
    await b.engine('wipe');
    const open0 = await b.engine('open', { vfs: 'opfs-sahpool' });
    const rss0 = extensionRssMB();
    const load = await b.engine('load', { pages });
    const rssLoaded = extensionRssMB();
    const distinctive = await b.engine('bench', { mode: 'distinctive', n: 300 });
    const distinctiveF = await b.engine('bench', { mode: 'distinctive', n: 300, filtered: true });
    const frequency = await b.engine('bench', { mode: 'frequency', n: 300 });
    const rssQueried = extensionRssMB();
    const mem = await b.engine('mem');
    const integ = await b.engine('integrity');
    // warm re-open (worker alive, DB handle closed and reopened)
    const warm = [];
    for (let i = 0; i < 5; i++) {
      await b.engine('close');
      const t0 = Date.now();
      const r = await b.engine('open', { vfs: 'opfs-sahpool' });
      warm.push(r.openMs + r.schemaMs);
    }
    // cold: close the offscreen document, recreate, open, first query (end-to-end as seen by the service worker caller)
    const cold = [];
    const coldQuery = [];
    for (let i = 0; i < 5; i++) {
      await b.sw({ cmd: 'offscreen-close' });
      const t0 = Date.now();
      await b.sw({ cmd: 'offscreen-ensure' });
      const o = await b.engine('open', { vfs: 'opfs-sahpool' });
      const t1 = Date.now();
      await b.engine('query', { q: 'ba' });
      const t2 = Date.now();
      cold.push(t1 - t0);
      coldQuery.push(t2 - t0);
      if (i === 0) out({ note: 'cold open breakdown (ms)', pages: o.pages, wasmInitMs: o.wasmInitMs, openMs: o.openMs, schemaMs: o.schemaMs });
    }
    out({ engine: 'fts5-opfs-sahpool', pages, firstOpenMs: open0.totalMs, load, rssMB: { baseline: Math.round(rss0), afterLoad: Math.round(rssLoaded), afterQueries: Math.round(rssQueried) }, workerMem: mem, distinctive, distinctiveFiltered: distinctiveF, frequency, integrity: integ, warmReopenMs: { median: median(warm), all: warm.map((x) => +x.toFixed(1)) }, coldOpenMs: { median: median(cold), all: cold }, coldFirstQueryMs: { median: median(coldQuery), all: coldQuery } });
    await b.engine('wipe');
  });

  // ---------------- MiniSearch (fallback) ----------------
  await session(async (b) => {
    await b.engine('open', { vfs: 'memory' });
    const rss0 = extensionRssMB();
    const build = await b.engine('msBuild', { pages });
    const rssBuilt = extensionRssMB();
    const distinctive = await b.engine('msBench', { mode: 'distinctive' });
    const frequency = await b.engine('msBench', { mode: 'frequency' });
    const cold = await b.engine('msColdStart');
    out({ engine: 'minisearch', pages, build, rssMB: { baseline: Math.round(rss0), afterBuild: Math.round(rssBuilt) }, distinctive, frequency, coldStart: cold });
  });
}
