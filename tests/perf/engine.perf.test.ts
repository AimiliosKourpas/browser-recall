// Focused regression guards for the properties M0 validated (docs/spikes/M0-RESULTS.md S2), on the PRODUCTION engine at 20K
// pages. Not part of `npm test` (too slow for the inner loop): `npm run test:perf`; CI runs it on pushes to main.
// Node + in-memory SQLite: absolute numbers differ from the browser, but ratios and orders of magnitude are what guard
// against accidental regressions (e.g. FTS5 snippet(), a lost prefix='3', stored text duplicated in the FTS index).
import { describe, expect, it } from 'vitest';
import { fold, tokenize } from '../../src/engine/fold';
import { generateCorpus, rng, type SynthDoc } from '../support/corpus';
import { loadCorpus } from '../support/load';
import { newStore, NOW } from '../helpers/engine';

const PAGES = Number(process.env.PERF_PAGES ?? 20_000);
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;
const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.5)] as number;

function queries(docs: SynthDoc[], mode: 'distinctive' | 'frequency', n: number): string[] {
  const r = rng(mode === 'frequency' ? 8 : 7);
  const counts = new Map<string, number>();
  for (const d of docs.slice(0, 300)) for (const w of tokenize(fold(d.body))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const common = new Set([...counts].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([w]) => w));
  const out: string[] = [];
  while (out.length < n) {
    const d = docs[Math.floor(r() * docs.length)] as SynthDoc;
    const words = d.body.split(' ');
    const q: string[] = [];
    for (let k = 1 + Math.floor(r() * 3); q.length < k; ) {
      const w = words[Math.floor(r() * words.length)] as string;
      if (mode === 'distinctive' && common.has(fold(w))) continue;
      q.push(w);
    }
    if (r() < 0.5) q[q.length - 1] = [...(q[q.length - 1] as string)].slice(0, Math.max(3, Math.ceil(q[q.length - 1]!.length * 0.7))).join('');
    out.push(q.join(' '));
  }
  return out;
}

describe(`engine performance guards at ${PAGES} pages (M0 baselines in comments)`, () => {
  it('ingest, size, latency, maintenance', async () => {
    const docs = generateCorpus({ pages: PAGES, now: NOW });
    const enc = new TextEncoder();
    const textBytes = docs.reduce((a, d) => a + enc.encode(d.title + d.headings + d.description + d.body).length, 0); // UTF-8 bytes (Greek = 2 per letter)
    const { store } = await newStore();

    let t = performance.now();
    loadCorpus(store, docs);
    const ingestPerSec = PAGES / ((performance.now() - t) / 1000);

    const stats = store.stats();
    const ratio = stats.dbBytes / textBytes;

    const measure = (qs: string[], extra: Record<string, unknown> = {}) => {
      const xs: number[] = [];
      for (const q of qs) {
        t = performance.now();
        store.search({ query: q, now: NOW, ...extra });
        xs.push(performance.now() - t);
      }
      return { p50: p50(xs), p95: p95(xs) };
    };
    const distinctive = measure(queries(docs, 'distinctive', 300));
    const filtered = measure(queries(docs, 'distinctive', 300).map((q) => `${q} site:${docs[0]!.domain} after:2026-04-01`));
    const adversarial = measure(queries(docs, 'frequency', 300));
    const filteredAny = measure(queries(docs, 'distinctive', 300).map((q) => `${q} after:2026-04-01`));

    t = performance.now();
    const integrity = store.integrityCheck();
    const integrityMs = performance.now() - t;
    const report = { pages: PAGES, textMB: +(textBytes / 1e6).toFixed(1), dbMB: +(stats.dbBytes / 1e6).toFixed(1), dbOverText: +ratio.toFixed(2), ingestPagesPerSec: Math.round(ingestPerSec), distinctive, filtered, filteredAny, adversarial, integrityMs: Math.round(integrityMs) };
    console.log(JSON.stringify(report));

    // M0 (node, 20K): DB 1.97× text; distinctive p95 15 ms; filtered p95 8 ms; adversarial p95 ~100 ms; ingest ~1,600 pages/s (batched)
    expect(ratio, 'DB size must stay <= 2x the stored text (blueprint §5.6)').toBeLessThanOrEqual(2.0);
    expect(filtered.p95, 'p95 with filters <= 100 ms (blueprint §5.6)').toBeLessThanOrEqual(100);
    expect(filteredAny.p95).toBeLessThanOrEqual(100);
    expect(distinctive.p95).toBeLessThanOrEqual(100);
    expect(adversarial.p95, 'stop-word-like queries are the known weak spot; guard against it getting worse').toBeLessThanOrEqual(300);
    expect(ingestPerSec).toBeGreaterThanOrEqual(150);
    expect(integrity.ok).toBe(true);

    // churn then bounded maintenance: file shrinks, data intact (A7)
    store.deleteRange(0, NOW - 200 * 86_400_000);
    const before = store.stats();
    for (let i = 0; i < 200 && store.stats().freelistPages > 0; i++) store.maintenance({ vacuumPages: 2000, minFreePages: 1 });
    const after = store.stats();
    expect(after.dbBytes).toBeLessThan(before.dbBytes);
    expect(after.freelistPages).toBe(0);
    expect(store.integrityCheck().ok).toBe(true);
  }, 600_000);
});
