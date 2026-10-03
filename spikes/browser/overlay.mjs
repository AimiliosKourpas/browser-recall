// Overlay spike: iframe-in-page host injected on demand; strict-CSP pages, framed pages, focus theft, fullscreen,
// key isolation, focus return, use_dynamic_url, popup-window fallback on chrome:// pages.
// Usage: xvfb-run -a node spikes/browser/overlay.mjs [variant]   (variant: test | dyn)
import { launch, extensionIds, benchPage, sleep, fmt, pngPixel } from './harness.mjs';
import { startServer } from './fixtures-server.mjs';

const variant = process.argv[2] ?? 'test';
const { port, base, requests } = await startServer();
const { ctx } = await launch({ exts: [variant] });
const [id] = await extensionIds(ctx);
const b = await benchPage(ctx, id);
await b.engine('open', { vfs: 'memory' });
await b.engine('load', { pages: 500 });
const results = [];
const rec = (name, r) => { results.push({ name, ...r }); console.log(fmt({ name, ...r })); };

const tabIdFor = (page) => b.page.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, page.url().split('#')[0]);
const overlayFrame = (page) => page.frames().find((f) => f.url().startsWith(`chrome-extension://`) && f.url().includes('search.html'));
const waitFrame = async (page, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const f = overlayFrame(page); if (f) return f; await sleep(20); } return undefined; };

async function scenario(name, path, { inert = false, before, actions } = {}) {
  const page = await ctx.newPage();
  await page.goto(`${base}/f/${path}.html`);
  await page.bringToFront();
  if (inert) await page.evaluate(() => document.documentElement.setAttribute('data-br-inert', '1'));
  await page.click('#field').catch(() => {});
  await page.keyboard.type('pre');
  if (before) await before(page);
  const keysBefore = await page.evaluate(() => window.__keys.length);
  const tabId = await tabIdFor(page);
  const t0 = Date.now();
  const res = await b.sw({ cmd: 'open-search', tabId });
  const frame = await waitFrame(page);
  const info = { surface: res.surface, frameFound: !!frame };
  if (!frame) { rec(name, { ...info, ok: false }); await page.close(); return; }
  info.frameAtMs = Date.now() - t0;
  while (Date.now() - t0 < 3000 && !(await frame.evaluate(() => document.activeElement?.id === 'q' && document.hasFocus()).catch(() => false))) await sleep(10);
  info.focusedMs = Date.now() - t0;
  info.frameUrl = frame.url().replace(id, '<id>');
  // paint check: overlay is white (#fff) on a #123 page; sample where the overlay sits (10vh down, centred)
  const paintedAtLocal = async () => {
    const { W, H } = await page.evaluate(() => ({ W: innerWidth, H: innerHeight }));
    const [r, g, bl] = pngPixel(await page.screenshot(), Math.floor(W / 2), Math.floor(H * 0.1 + 150));
    return r > 200 && g > 200 && bl > 200;
  };
  const paintedAt = paintedAtLocal;
  info.painted = await paintedAt();
  // typing as a user would: keystrokes go to whatever has focus, NO click into the overlay first
  await page.keyboard.type('secret', { delay: 15 });
  info.typed = await frame.locator('#q').inputValue();
  await frame.waitForFunction(() => /hits in/.test(document.getElementById('status').textContent), null, { timeout: 5000 }).catch(() => {});
  info.status = await frame.locator('#status').textContent();
  const keysAfter = await page.evaluate(() => window.__keys.length);
  info.pageSawKeys = keysAfter - keysBefore;
  info.pageSawKeyLog = await page.evaluate((n) => window.__keys.slice(n), keysBefore);
  // Page-side visibility: can the page find the iframe or read into it?
  info.pageQuerySelectorIframe = await page.evaluate(() => !!document.querySelector('iframe') && document.querySelectorAll('iframe').length);
  info.pageActiveElement = await page.evaluate(() => document.activeElement?.tagName);
  info.topLayer = await b.page.evaluate((t) => chrome.tabs.sendMessage(t, { cmd: 'overlay-info' }), tabId);
  if (actions) Object.assign(info, await actions(page, frame, tabId, paintedAt));
  // Escape closes and returns focus
  await page.keyboard.press('Escape');
  await sleep(150);
  info.closed = !overlayFrame(page);
  info.focusReturnedTo = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  rec(name, info);
  await page.close();
}

await scenario('plain', 'plain');
await scenario('strict-csp (default-src none; no script, frame-src self)', 'strict-csp');
await scenario('frame-src none (page forbids all framing)', 'frame-src-none');
await scenario('framed page (top overlay over a page containing an iframe)', 'framed');
await scenario('focus-steal (page refocuses its input every 50 ms), no mitigation', 'focus-steal');
await scenario('focus-steal with body.inert mitigation', 'focus-steal', { inert: true });
await scenario('fullscreen element already active when overlay opens', 'plain', {
  before: async (page) => { await page.evaluate(() => document.getElementById('fs').requestFullscreen()); await sleep(600); },
  actions: async (page, _f, _t, paintedAt) => {
    return { fullscreenActive: await page.evaluate(() => !!document.fullscreenElement), paintedInFullscreen: await paintedAt() };
  },
});

// Latency: warm open-to-ready on plain, 10 runs
{
  const page = await ctx.newPage();
  await page.goto(`${base}/f/plain.html`);
  await page.bringToFront();
  const tabId = await tabIdFor(page);
  const xs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    await b.sw({ cmd: 'open-search', tabId });
    const f = await waitFrame(page);
    while (!(await f.evaluate(() => document.activeElement?.id === 'q' && document.hasFocus()).catch(() => false))) await sleep(5);
    xs.push(Date.now() - t0);
    await page.keyboard.press('Escape');
    await sleep(100);
  }
  xs.sort((a, c) => a - c);
  rec('open-to-focused latency (10 runs, ms; driver round-trip incl. executeScript + iframe load + focus)', { runs: xs, median: xs[5], max: xs[9] });
  await page.close();
}

// Restricted pages: injection must fail and the popup-window fallback must open
for (const url of ['chrome://version', 'chrome://newtab', 'about:blank']) {
  const page = await ctx.newPage();
  await page.goto(url).catch(() => {});
  await page.bringToFront();
  const tabId = await b.page.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
  const before = ctx.pages().length;
  const res = await b.sw({ cmd: 'open-search', tabId });
  await sleep(800);
  const popup = ctx.pages().find((p) => p.url().includes('search.html') && p !== page);
  const ev = (await b.sw({ cmd: 'events' })).filter((e) => e.kind === 'overlay-failed').slice(-1)[0];
  rec(`restricted page ${url}`, { surface: res.surface, popupOpened: !!popup, failure: String(ev?.data).slice(0, 160) });
  await popup?.close();
  await page.close();
}
console.log('fixture server saw', requests.length, 'requests');
await ctx.close();
process.exit(0);
