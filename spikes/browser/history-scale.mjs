// history.search behaviour and import cost at scale (100K rows spread over 89 days).
import { launch, extensionIds, benchPage, sleep, fmt } from './harness.mjs';
import { rmSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const N = Number(process.argv[2] ?? 100000);
const profile = join(import.meta.dirname, '.tmp/scale-profile');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
{ // create the profile once so Chromium writes its History schema, then close
  const { ctx } = await launch({ exts: ['test'], userDataDir: profile });
  await sleep(3000);
  await ctx.close();
}
await sleep(1500);
console.log(execFileSync('python3', [join(import.meta.dirname, 'seed-history.py'), profile, String(N)]).toString().trim());
const { ctx } = await launch({ exts: ['test'], userDataDir: profile });
const [id] = await extensionIds(ctx);
const b = await benchPage(ctx, id);
const search = (query) => b.page.evaluate(async (q) => { const t = performance.now(); const r = await chrome.history.search(q); return { n: r.length, ms: Math.round(performance.now() - t), bytes: JSON.stringify(r).length, first: r[0]?.url, rows: undefined }; }, query);
const DAY = 86400_000, now = Date.now();
console.log(fmt({ s: 'default maxResults (omitted), startTime:0', ...await search({ text: '', startTime: 0 }) }));
console.log(fmt({ s: 'maxResults=1000, startTime:0', ...await search({ text: '', startTime: 0, maxResults: 1000 }) }));
console.log(fmt({ s: 'omitted startTime (default window)', ...await search({ text: '', maxResults: 1000000 }) }));
console.log(fmt({ s: 'S1 single call startTime:0 maxResults=1e6', ...await search({ text: '', startTime: 0, maxResults: 1000000 }) }));
{ // S2: 7-day windows, big maxResults
  const t0 = Date.now(); let total = 0, calls = 0, maxWin = 0;
  for (let start = now - 91 * DAY; start < now + DAY; start += 7 * DAY) { const r = await search({ text: '', startTime: start, endTime: start + 7 * DAY, maxResults: 1000000 }); total += r.n; calls++; maxWin = Math.max(maxWin, r.n); }
  console.log(fmt({ s: 'S2 7-day windows, maxResults=1e6', calls, total, largestWindow: maxWin, totalMs: Date.now() - t0 }));
}
{ // S3: maxResults=1000 windows, subdivide on truncation (what a bounded-memory importer would do)
  const t0 = Date.now(); let total = 0, calls = 0;
  const walk = async (a, z) => { const r = await b.page.evaluate((q) => chrome.history.search(q), { text: '', startTime: a, endTime: z, maxResults: 1000 }); calls++; if (r.length >= 1000 && z - a > 60_000) { const m = Math.floor((a + z) / 2); await walk(a, m); await walk(m, z); } else total += r.length; };
  for (let start = now - 91 * DAY; start < now + DAY; start += 7 * DAY) await walk(start, start + 7 * DAY);
  console.log(fmt({ s: 'S3 adaptive windows, maxResults=1000/call (subdivide when full)', calls, total, totalMs: Date.now() - t0 }));
}
// End-to-end import into the engine (title-only rows) via SW -> offscreen -> worker, batches of 1000 over runtime messaging
await b.engine('open', { vfs: 'opfs-sahpool' });
await b.engine('wipe');
await b.engine('open', { vfs: 'opfs-sahpool' });
{
  const t0 = Date.now();
  let imported = 0, engineMs = 0;
  const rows = await b.page.evaluate(async () => (await chrome.history.search({ text: '', startTime: 0, maxResults: 1000000 })).map((r) => ({ url: r.url, title: r.title, lastVisitTime: r.lastVisitTime, visitCount: r.visitCount })));
  const readMs = Date.now() - t0;
  const t1 = Date.now();
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000).filter((r) => /^https?:/.test(r.url));
    const r = await b.engine('insertRows', { rows: batch });
    imported += r.n; engineMs += r.ms;
  }
  const dbs = await b.engine('dbsize');
  console.log(fmt({ s: 'import to engine (title-only, FTS5+trigram)', rows: rows.length, imported, readFromHistoryMs: readMs, engineInsertMsSum: engineMs, wallMsForBatches: Date.now() - t1, rowsPerSec: Math.round(imported / ((Date.now() - t1) / 1000)), ...dbs }));
  const xs = [];
  for (const q of ['ba ko', 'qua pro', 'vi dex', 'hy jo', 'fu gra', 'cal nal', 'mor ist', 'su ten', 'er on', 'la ri']) { const r = await b.engine('query', { q }); xs.push(r.ms); }
  console.log(fmt({ s: 'title-only 100K query latency (10 queries, ms inside worker)', xs }));
}
await b.engine('wipe');
await ctx.close();
process.exit(0);
