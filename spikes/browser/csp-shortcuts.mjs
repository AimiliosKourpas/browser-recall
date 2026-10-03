// (1) Does Chrome accept the locked-down extension_pages CSP, and what does it report for a bad one?
// (2) What does the CSP actually stop? Compare outbound requests from every extension context under the locked CSP vs the default CSP.
// (3) Shortcut conflicts: two extensions with the same suggested key, detection via commands.getAll.
import { launch, extensionIds, benchPage, sleep, fmt } from './harness.mjs';
import { startServer } from './fixtures-server.mjs';

const { base, requests } = await startServer();

// ---------- (1) manifest acceptance via chrome://extensions developerPrivate ----------
for (const v of ['base']) {
  let ctx;
  try {
    ({ ctx } = await launch({ exts: [v] }));
  } catch (e) {
    console.log(fmt({ part: 1, variant: v, launchFailed: String(e.message).split('\n')[0] }));
    continue;
  }
  await sleep(1500);
  const sws = ctx.serviceWorkers().length;
  const page = await ctx.newPage();
  await page.goto('chrome://extensions');
  const info = await page.evaluate(async () => {
    const list = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true });
    return list.map((e) => ({ name: e.name, state: e.state, disableReasons: e.disableReasons, manifestErrors: e.manifestErrors?.map((x) => x.message), installWarnings: e.installWarnings?.map((w) => w.message ?? w), runtimeErrors: e.runtimeErrors?.length }));
  }).catch((e) => `developerPrivate unavailable: ${e.message}`);
  console.log(fmt({ part: 1, variant: v, serviceWorkersRunning: sws, info }));
  await ctx.close();
}

// ---------- (2) outbound probes under locked CSP ('base' has no host perms) vs default CSP ('nocsp') ----------
for (const v of ['base', 'nocsp']) {
  const mark = `/probe-${v}`;
  const before = requests.length;
  const { ctx } = await launch({ exts: [v] });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  await b.sw({ cmd: 'offscreen-ensure' });
  const u = (k) => `${base}${mark}-${k}`;
  const pageProbe = await b.page.evaluate(async (urls) => {
    const out = {};
    try { await fetch(urls.fetch, { mode: 'no-cors' }); out.fetch = 'sent'; } catch (e) { out.fetch = 'blocked'; }
    try { out.beacon = navigator.sendBeacon(urls.beacon, 'x') ? 'queued' : 'refused'; } catch (e) { out.beacon = 'blocked'; }
    out.img = await new Promise((r) => { const i = new Image(); i.onload = i.onerror = () => r('settled'); i.src = urls.img; setTimeout(() => r('timeout'), 1000); });
    try { const ws = new WebSocket(urls.ws.replace('http', 'ws')); out.ws = await new Promise((r) => { ws.onopen = () => r('open'); ws.onerror = () => r('error'); setTimeout(() => r('timeout'), 1000); }); } catch (e) { out.ws = 'blocked-sync'; }
    try { const x = new XMLHttpRequest(); x.open('GET', urls.xhr); x.send(); out.xhr = 'sent'; } catch (e) { out.xhr = 'blocked-sync'; }
    const link = document.createElement('link'); link.rel = 'prefetch'; link.href = urls.prefetch; document.head.append(link);
    return out;
  }, { fetch: u('fetch'), beacon: u('beacon'), img: u('img'), ws: u('ws'), xhr: u('xhr'), prefetch: u('prefetch') });
  const worker = await b.engine('netprobe', { url: u('worker-fetch') });
  const sw = (await b.sw({ cmd: 'netprobe', url: u('sw-fetch') })).result;
  await sleep(1500);
  const hit = requests.slice(before).map((r) => r.url).filter((x) => x.startsWith(mark));
  console.log(fmt({ part: 2, variant: v, extensionPageProbe: pageProbe, workerFetch: worker, serviceWorkerFetch: sw, requestsActuallyReceivedByServer: hit }));
  await ctx.close();
}

// ---------- (3) shortcut conflicts ----------
{
  const { ctx } = await launch({ exts: ['test', 'dup'] });
  const ids = await extensionIds(ctx, 2);
  const out = [];
  for (const id of ids) {
    const b = await benchPage(ctx, id);
    const cmds = await b.sw({ cmd: 'commands' });
    out.push({ id, openSearch: cmds.find((c) => c.name === 'open-search') });
  }
  console.log(fmt({ part: 3, note: 'two extensions with identical suggested_key', out }));
  await ctx.close();
}
process.exit(0);
