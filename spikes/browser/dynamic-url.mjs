// Can a web page fingerprint the extension by probing its web_accessible_resources at the static id? (use_dynamic_url)
import { launch, extensionIds, benchPage, fmt } from './harness.mjs';
import { startServer } from './fixtures-server.mjs';
const { base } = await startServer();
for (const variant of ['test', 'dyn']) {
  const { ctx } = await launch({ exts: [variant] });
  const [id] = await extensionIds(ctx);
  const b = await benchPage(ctx, id);
  const page = await ctx.newPage();
  await page.goto(`${base}/f/plain.html`);
  const tabId = await b.page.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, page.url());
  await b.sw({ cmd: 'open-search', tabId });
  await new Promise((r) => setTimeout(r, 500));
  const frameUrl = page.frames().find((f) => f.url().includes('search.html'))?.url();
  const probe = await page.evaluate(async (id) => {
    try { const r = await fetch(`chrome-extension://${id}/search.js`); return `fetch ok status=${r.status}`; } catch (e) { return `fetch blocked: ${e.message}`; }
  }, id);
  const probeImg = await page.evaluate((id) => new Promise((res) => { const f = document.createElement('iframe'); f.src = `chrome-extension://${id}/search.html`; f.onload = () => res('static-id iframe loaded'); f.onerror = () => res('static-id iframe error'); document.body.append(f); setTimeout(() => res('static-id iframe: no load event in 1.5s'), 1500); }), id);
  console.log(fmt({ variant, extId: id, overlayFrameHost: frameUrl && new URL(frameUrl).host, sameAsStaticId: frameUrl && new URL(frameUrl).host === id, probe, probeImg }));
  await ctx.close();
}
process.exit(0);
