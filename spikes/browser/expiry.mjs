// Does history.onVisitRemoved fire when Chrome expires visits older than ~90 days on its own?
// Phase 1: seed visits dated 100 days ago (+ recent controls) via history.addUrl(visitTime), close browser.
// Phase 2: relaunch same profile (Chromium's HistoryBackend starts its expiry job after init); record events + history state.
import { launch, extensionIds, benchPage, fmt, sleep } from './harness.mjs';
import { rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const profile = join(import.meta.dirname, '.tmp/expiry-profile');
const maxMin = Number(process.argv[2] ?? 12);
rmSync(profile, { recursive: true, force: true });
const DAY = 86400_000;
// history.addUrl only accepts {url} in Chromium 141 (no visitTime/title), so old rows are written straight into the
// profile's History SQLite DB while the browser is closed (see seedOld below).
const recent = Array.from({ length: 10 }, (_, i) => ({ url: `https://recent-${i}.example/page` }));
const OLD_N = 70;
const seedOld = () => {
  writeFileSync(join(profile, 'seed.py'), `
import sqlite3, time
c = sqlite3.connect('${join(profile, 'Default/History')}')
epoch = lambda ms: int((ms + 11644473600000) * 1000)
now = int(time.time() * 1000)
for i in range(${OLD_N}):
    t = epoch(now - 100 * 86400000 - i * 1000)
    cur = c.execute("insert into urls(url,title,visit_count,typed_count,last_visit_time,hidden) values(?,?,?,?,?,0)", (f'https://old-{i}.example/page', f'old {i}', 1, 0, t))
    c.execute("insert into visits(url,visit_time,from_visit,transition,visit_duration) values(?,?,0,805306369,0)", (cur.lastrowid, t))
c.commit()
print('seeded old rows:', c.execute("select count(*) from urls where url like 'https://old-%'").fetchone()[0])
`);
  console.log(execFileSync('python3', [join(profile, 'seed.py')]).toString().trim());
};

{
  const { ctx } = await launch({ exts: ['test'], userDataDir: profile });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  await b.sw({ cmd: 'history-add', urls: recent });
  const found = await b.sw({ cmd: 'history-search', query: { text: '', startTime: 0, maxResults: 1000 } });
  console.log('phase1: recent rows via API:', found.filter((r) => r.url.includes('recent-')).length);
  await sleep(15000); // let the history backend commit
  await ctx.close();
}
await sleep(3000);
seedOld();
{
  const t0 = Date.now();
  const { ctx } = await launch({ exts: ['test'], userDataDir: profile });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  let last = -1;
  while ((Date.now() - t0) / 60000 < maxMin) {
    const rows = await b.sw({ cmd: 'history-search', query: { text: '', startTime: 0, maxResults: 1000 } });
    const oldLeft = rows.filter((r) => r.url.includes('old-')).length;
    const recentLeft = rows.filter((r) => r.url.includes('recent-')).length;
    const ev = await b.sw({ cmd: 'events' });
    const removed = ev.filter((e) => e.kind === 'removed');
    if (oldLeft !== last || removed.length) console.log(`t=${Math.round((Date.now() - t0) / 1000)}s oldLeft=${oldLeft} recentLeft=${recentLeft} removedEvents=${removed.length}`);
    last = oldLeft;
    if (oldLeft === 0) {
      console.log('expiry finished; removed events:', removed.length);
      console.log('sample event:', String(fmt(removed[0]?.data)).slice(0, 300));
      console.log('urls reported total:', removed.reduce((a, e) => a + (e.data.urls?.length ?? 0), 0), 'allHistory flags:', removed.map((e) => e.data.allHistory));
      break;
    }
    await sleep(20000);
  }
  if (last > 0) {
    const ev = await b.sw({ cmd: 'events' });
    console.log(`TIMEOUT after ${maxMin} min: oldLeft=${last}; removed events=${ev.filter((e) => e.kind === 'removed').length}`);
  }
  await ctx.close();
}
