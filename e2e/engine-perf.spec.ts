// Browser-side guard for the production engine (real SQLite WASM on OPFS, through the real service-worker/offscreen path).
// Deliberately small (2K pages) so it stays in the normal e2e run; the 20K-page numbers are in tests/perf (Node) and the
// M0 browser benchmark (docs/spikes/M0-RESULTS.md S2) is the baseline.
import { generateCorpus, rng } from '../tests/support/corpus';
import { expect, openExtensionPage, test } from './fixtures';

const PAGES = 2000;
const NOW = Date.UTC(2026, 9, 3);

test('engine in the browser: ingest throughput and search latency stay in budget', async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const docs = generateCorpus({ pages: PAGES, now: NOW });
  const page = await openExtensionPage(context, extensionId, 'search.html');
  await expect(page.getByRole('status')).toHaveText('Local search engine ready.');

  const rows = docs.map((d) => ({ url: d.url, title: d.title, lastVisitTime: d.lastVisit, visitCount: d.visitCount }));
  const t0 = Date.now();
  await page.evaluate(async (all) => {
    for (let i = 0; i < all.length; i += 500) await chrome.runtime.sendMessage({ type: 'sw/engine', call: { method: 'upsertHistory', params: { rows: all.slice(i, i + 500) } } });
  }, rows);
  const historyMs = Date.now() - t0;

  const contents = docs.map((d) => ({ url: d.url, headings: d.headings, description: d.description, body: d.body, indexedAt: d.lastVisit }));
  const t1 = Date.now();
  await page.evaluate(async (all) => {
    for (const params of all) await chrome.runtime.sendMessage({ type: 'sw/engine', call: { method: 'upsertContent', params } });
  }, contents);
  const contentMs = Date.now() - t1;

  const r = rng(11);
  const queries = Array.from({ length: 150 }, () => {
    const d = docs[Math.floor(r() * docs.length)]!;
    const words = d.body.split(' ');
    return `${words[Math.floor(r() * words.length)]} ${words[Math.floor(r() * words.length)]!.slice(0, 4)}`;
  });
  const timing = await page.evaluate(async (qs) => {
    const out: number[] = [];
    const took: number[] = [];
    for (const query of qs) {
      const t = performance.now();
      const r = (await chrome.runtime.sendMessage({ type: 'sw/engine', call: { method: 'search', params: { query, now: 1_790_000_000_000 } } })) as { data: { tookMs: number } };
      out.push(performance.now() - t);
      took.push(r.data.tookMs);
    }
    return { out, took };
  }, queries);
  const times = timing.out;
  times.sort((a, b) => a - b);
  const took = timing.took.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)]!;
  const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
  const stats = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/engine', call: { method: 'stats' } }));
  console.log(JSON.stringify({ pages: PAGES, historyRowsPerSec: Math.round(PAGES / (historyMs / 1000)), contentPagesPerSec: Math.round(PAGES / (contentMs / 1000)), searchRoundTripMs: { p50: +p50.toFixed(1), p95: +p95.toFixed(1) }, engineTookMs: { p50: took[Math.floor(took.length / 2)], p95: took[Math.ceil(took.length * 0.95) - 1] }, stats: (stats as { data: unknown }).data }));
  expect(p95, 'search round trip (UI → service worker → offscreen → worker → SQLite) p95').toBeLessThan(250);
  expect(PAGES / (contentMs / 1000), 'Deep Search content ingest, pages/s').toBeGreaterThan(40);
  expect(PAGES / (historyMs / 1000), 'history ingest, rows/s').toBeGreaterThan(500);
});
