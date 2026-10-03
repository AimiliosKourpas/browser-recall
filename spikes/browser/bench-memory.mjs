// Steady-state engine memory: load N pages, then CLOSE the offscreen document (drops the corpus generator garbage),
// recreate it, reopen the DB, run 300 queries and measure RSS of the extension renderer process(es).
// Also records first-query latency after a cold start using a distinctive query.
import { launch, extensionIds, benchPage, extensionRssMB, sleep, fmt } from './harness.mjs';
for (const pages of (process.argv[2] ?? '20000,50000').split(',').map(Number)) {
  const { ctx } = await launch({ exts: ['base'] });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  await b.sw({ cmd: 'offscreen-ensure' });
  await b.engine('open', { vfs: 'opfs-sahpool' });
  await b.engine('wipe');
  await b.engine('open', { vfs: 'opfs-sahpool' });
  await sleep(500);
  const baseline = extensionRssMB();
  await b.engine('load', { pages });
  const afterLoad = extensionRssMB();
  const firstQs = [];
  for (let i = 0; i < 5; i++) {
    await b.sw({ cmd: 'offscreen-close' });
    await sleep(300);
    await b.sw({ cmd: 'offscreen-ensure' });
    await b.engine('open', { vfs: 'opfs-sahpool' });
    // distinctive query needs the corpus the worker generated; derive from the DB itself: a rare-ish title word
    const t0 = Date.now();
    await b.engine('query', { q: 'qua pro' });
    firstQs.push(Date.now() - t0);
  }
  const lat = await b.engine('benchFromDb', { n: 300 });
  await sleep(1000);
  const steady = extensionRssMB();
  const mem = await b.engine('mem');
  console.log(fmt({ pages, rssMB: { baselineEmptyEngine: Math.round(baseline), afterLoadWithCorpusGarbage: Math.round(afterLoad), steadyAfterColdRestartAnd300Queries: Math.round(steady), deltaVsBaseline: Math.round(steady - baseline) }, wasmHeapMB: mem.wasmHeapMB, firstQueryAfterColdOpenMs: firstQs, queryLatencyFromDbSampledQueries: lat }));
  await b.engine('wipe');
  await ctx.close();
}
process.exit(0);
