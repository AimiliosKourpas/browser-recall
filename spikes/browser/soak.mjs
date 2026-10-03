// Compressed soak: continuous live-index churn (insert + delete rolling window) with injected faults
// (offscreen document closed mid-write, service worker terminated) and periodic integrity checks.
// NOT a real 24 h soak: it compresses a day of indexing volume into minutes. Usage: node soak.mjs <minutes>
import { launch, extensionIds, benchPage, extensionRssMB, sleep, fmt } from './harness.mjs';

const minutes = Number(process.argv[2] ?? 15);
const out = (o) => console.log(fmt({ t: Math.round((Date.now() - T0) / 1000), ...o }));
const T0 = Date.now();
const { ctx } = await launch({ exts: ['base'] });
const [id] = await extensionIds(ctx);
const b = await benchPage(ctx, id);
await b.sw({ cmd: 'offscreen-ensure' });
await b.engine('open', { vfs: 'opfs-sahpool' });
await b.engine('wipe');
await b.engine('open', { vfs: 'opfs-sahpool' });
await b.engine('load', { pages: 5000 });
out({ event: 'seeded', pages: 5000, dbMB: (await b.engine('dbsize')).dbMB, rssMB: Math.round(extensionRssMB()) });

async function stopSw() {
  const cdp = await ctx.newCDPSession(b.page);
  const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => e.versions.forEach((v) => versions.set(v.versionId, v)));
  await cdp.send('ServiceWorker.enable');
  await sleep(300);
  for (const v of versions.values()) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  await cdp.detach().catch(() => {});
}
const s = { inserted: 0, deleted: 0, queries: 0, offscreenCloses: 0, swStops: 0, errors: [], maxReopenMs: 0, reopenMs: [], firstQueryAfterReopenMs: [], consistencyChecks: 0, consistencyFailures: 0, rss: [] };
let nextClose = Date.now() + 20_000, nextSw = Date.now() + 33_000, nextCheck = Date.now() + 180_000, nextRss = Date.now() + 60_000;
const end = Date.now() + minutes * 60_000;

async function reopen() {
  const t0 = Date.now();
  await b.sw({ cmd: 'offscreen-ensure' });
  const o = await b.engine('open', { vfs: 'opfs-sahpool' });
  const ms = Date.now() - t0;
  s.reopenMs.push(ms); s.maxReopenMs = Math.max(s.maxReopenMs, ms);
  const t1 = Date.now();
  await b.engine('query', { q: 'qua pro' });
  s.firstQueryAfterReopenMs.push(Date.now() - t1);
  return o;
}
while (Date.now() < end) {
  try {
    const r = await b.engine('churn', { n: 10, deleteOld: true });
    s.inserted += r.inserted; s.deleted += r.deleted;
    for (let i = 0; i < 3; i++) { await b.engine('query', { q: ['ba ko', 'qua pro', 'vi dex'][i] }); s.queries++; }
  } catch (e) { s.errors.push(String(e).slice(0, 160)); try { await reopen(); } catch (e2) { s.errors.push('reopen:' + String(e2).slice(0, 160)); } }
  const now = Date.now();
  if (now >= nextClose) {
    nextClose = now + 20_000;
    b.sw({ cmd: 'engine', engineCmd: 'churn', args: { n: 400, deleteOld: true } }).catch(() => {}); // in flight when we pull the plug
    await sleep(Math.floor(Math.random() * 400));
    await b.sw({ cmd: 'offscreen-close' });
    s.offscreenCloses++;
    try { await reopen(); } catch (e) { s.errors.push('reopen-after-close:' + String(e).slice(0, 160)); }
  }
  if (now >= nextSw) { nextSw = now + 45_000; await stopSw(); s.swStops++; }
  if (now >= nextRss) { nextRss = now + 60_000; s.rss.push(Math.round(extensionRssMB())); out({ event: 'progress', inserted: s.inserted, deleted: s.deleted, closes: s.offscreenCloses, swStops: s.swStops, errors: s.errors.length, rssMB: s.rss.at(-1) }); }
  if (now >= nextCheck) {
    nextCheck = now + 180_000;
    const c = await b.engine('consistency').catch((e) => ({ error: String(e) }));
    s.consistencyChecks++;
    if (!c.consistent || c.ftsIntegrity !== 'ok' || c.sqliteIntegrity?.[0] !== 'ok') s.consistencyFailures++;
    out({ event: 'consistency', ...c });
  }
  await sleep(250);
}
const final = await b.engine('consistency');
const dbs = await b.engine('dbsize');
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
out({ event: 'FINAL', minutes, inserted: s.inserted, deleted: s.deleted, queries: s.queries, offscreenClosesMidWrite: s.offscreenCloses, swStops: s.swStops, errors: s.errors.length, errorSamples: s.errors.slice(0, 3), reopenMs: { median: med(s.reopenMs), max: s.maxReopenMs, n: s.reopenMs.length }, firstQueryAfterReopenMs: { median: med(s.firstQueryAfterReopenMs), max: Math.max(...s.firstQueryAfterReopenMs) }, rssSeriesMB: s.rss, finalConsistency: final, dbMB: dbs.dbMB, consistencyChecks: s.consistencyChecks + 1, consistencyFailures: s.consistencyFailures + (final.consistent && final.ftsIntegrity === 'ok' && final.sqliteIntegrity[0] === 'ok' ? 0 : 1) });
await b.engine('wipe');
await ctx.close();
process.exit(0);
