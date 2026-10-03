// MV3 lifecycle resilience: SW termination, Port survival, offscreen close mid-write, browser SIGKILL mid-write, single-owner lock.
import { launch, extensionIds, benchPage, sleep, fmt } from './harness.mjs';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const profile = join(import.meta.dirname, '.tmp/resilience-profile');
rmSync(profile, { recursive: true, force: true });
const out = (o) => console.log(fmt(o));

/** Terminate the extension service worker via CDP (ServiceWorker.stopWorker) and return its reported running status. */
async function killSw(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const versions = new Map();
  cdp.on('ServiceWorker.workerVersionUpdated', (e) => e.versions.forEach((v) => versions.set(v.versionId, v)));
  await cdp.send('ServiceWorker.enable');
  await sleep(500);
  for (const v of versions.values()) await cdp.send('ServiceWorker.stopWorker', { versionId: v.versionId });
  await sleep(800);
  const status = [...versions.values()].map((v) => v.runningStatus);
  await cdp.detach().catch(() => {});
  return status.join(',');
}

{
  const { ctx } = await launch({ exts: ['base'], userDataDir: profile });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  await b.engine('open', { vfs: 'opfs-sahpool' });
  await b.engine('wipe');
  await b.engine('open', { vfs: 'opfs-sahpool' });
  await b.engine('load', { pages: 3000 });

  // 1. Named Port UI->engine keeps working with the service worker dead
  await b.page.evaluate(() => {
    window.__port = chrome.runtime.connect({ name: 'engine' });
    window.__resp = [];
    window.__port.onMessage.addListener((m) => window.__resp.push(m));
  });
  const q = async (rid) => { await b.page.evaluate((r) => window.__port.postMessage({ rid: r, cmd: 'query', args: { q: 'ba' } }), rid); await sleep(300); return b.page.evaluate((r) => window.__resp.some((m) => m.rid === r && m.ok), rid); };
  const okBefore = await q(1);
  const swAfterKill = await killSw(ctx, b.page);
  const okDuringSwDead = await q(2);
  const offscreenAlive = (await b.page.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length));
  // wake SW again through a message and confirm the routed path still works (offscreen survived SW termination)
  const ping = await b.sw({ cmd: 'ping' });
  const exists = await b.sw({ cmd: 'offscreen-exists' });
  const viaSw = await b.engine('query', { q: 'ba' });
  out({ test: 'SW termination (CDP ServiceWorker.stopWorker)', swStatusAfterStop: swAfterKill, portQueryBefore: okBefore, portQueryWhileSwDead: okDuringSwDead, offscreenContextsWhileSwDead: offscreenAlive, swWokeOnMessage: ping.ok, offscreenStillExistsAfterWake: exists.exists, queryViaRestartedSw: viaSw.hits > 0 });

  // 2. Offscreen closed in the middle of a big insert
  const pending = b.engine('load', { pages: 1 }).catch(() => 'n/a'); void pending;
  await b.engine('churn', { n: 10 });
  const longInsert = b.sw({ cmd: 'engine', engineCmd: 'churn', args: { n: 3000 } }).catch((e) => ({ error: String(e) }));
  await sleep(1200);
  await b.sw({ cmd: 'offscreen-close' });
  const settled = await Promise.race([longInsert, sleep(4000).then(() => 'still-pending-after-4s')]);
  await b.sw({ cmd: 'offscreen-ensure' });
  const tOpen = Date.now();
  const reopen = await b.engine('open', { vfs: 'opfs-sahpool' });
  const reopenWaitMs = Date.now() - tOpen;
  const cons = await b.engine('consistency');
  out({ test: 'offscreen close mid-insert', reopenAttempts: reopen.attempts, reopenWaitMs, inflightCallResult: typeof settled === 'string' ? settled : JSON.stringify(settled).slice(0, 120), reopenedPages: reopen.pages, consistency: cons });

  // 3. second connection to the same sahpool VFS from another worker (single-owner rule)
  const second = await b.page.evaluate(async () => {
    const w = new Worker('engine-worker.js', { type: 'module' });
    const r = await new Promise((res) => {
      w.onmessage = (e) => { if (e.data.ready) w.postMessage({ id: 1, cmd: 'open', args: { vfs: 'opfs-sahpool' } }); else res(e.data); };
      setTimeout(() => res({ timeout: true }), 8000);
    });
    w.terminate();
    return r;
  });
  out({ test: 'second concurrent owner of the same OPFS-sahpool DB', result: JSON.stringify(second).slice(0, 300) });

  // 4. Hard kill: SIGKILL the whole browser during a write burst
  const burst = b.sw({ cmd: 'engine', engineCmd: 'churn', args: { n: 4000 } }).catch(() => null); void burst;
  await sleep(1500);
  execSync("pkill -9 -x chrome || true");
  await sleep(1500);
  await ctx.close().catch(() => {});
}
{
  const { ctx } = await launch({ exts: ['base'], userDataDir: profile });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  const t0 = Date.now();
  let o;
  for (let i = 0; i < 10; i++) {
    try { o = await b.engine('open', { vfs: 'opfs-sahpool' }); break; } catch (e) { o = { error: String(e).slice(0, 200) }; await sleep(1000); }
  }
  const cons = o?.error ? null : await b.engine('consistency');
  out({ test: 'SIGKILL of the browser mid-write, relaunch same profile', openMs: Date.now() - t0, open: o, consistency: cons });
  await ctx.close();
}
process.exit(0);
