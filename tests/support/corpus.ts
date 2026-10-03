// Deterministic synthetic corpus (generated text only: license-safe). Zipf vocabulary, English-like and Greek (with tonos)
// documents. Shared by the eval harness and the performance guards. Derived from the M0 spike generator.
import { fold } from '../../src/engine/fold';

export interface SynthDoc {
  url: string;
  domain: string;
  title: string;
  headings: string;
  description: string;
  body: string;
  lastVisit: number;
  visitCount: number;
  greek: boolean;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATIN = ['ba', 'ko', 'ri', 'su', 'ten', 'la', 'mor', 'vi', 'dex', 'qua', 'pro', 'nal', 'ist', 'er', 'on', 'cal', 'fu', 'gra', 'hy', 'jo'];
const GREEK = ['κα', 'λη', 'μερ', 'α', 'νθρω', 'πο', 'βι', 'βλι', 'ο', 'συν', 'τα', 'γη', 'φω', 'τι', 'σμο', 'ρα', 'δι', 'ε', 'τρι', 'νε'];
const ACCENT: Record<string, string> = { α: 'ά', ε: 'έ', η: 'ή', ι: 'ί', ο: 'ό', υ: 'ύ', ω: 'ώ' };

function makeVocab(size: number, r: () => number, greek: boolean): string[] {
  const syl = greek ? GREEK : LATIN;
  const seen = new Set<string>();
  const words: string[] = [];
  let guard = 0;
  while (words.length < size && guard++ < size * 50) {
    let w = Array.from({ length: 1 + Math.floor(r() * 4) }, () => syl[Math.floor(r() * syl.length)]).join('');
    if (greek) {
      const vowels = [...w].map((c, i) => (ACCENT[c] ? i : -1)).filter((i) => i >= 0);
      if (vowels.length) {
        const i = vowels[Math.floor(r() * vowels.length)] as number;
        w = w.slice(0, i) + ACCENT[w[i] as string] + w.slice(i + 1);
      }
      if (r() < 0.4) w += 'ς';
    }
    if (!seen.has(fold(w))) {
      seen.add(fold(w));
      words.push(w);
    }
  }
  return words;
}

function zipf(n: number, r: () => number, s = 1.05): () => number {
  const cdf = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) cdf[i] = sum += 1 / Math.pow(i + 1, s);
  for (let i = 0; i < n; i++) cdf[i] = (cdf[i] as number) / sum;
  return () => {
    const u = r();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((cdf[mid] as number) < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export interface CorpusOptions {
  pages: number;
  seed?: number;
  greekFraction?: number;
  vocab?: number;
  meanBytes?: number;
  capBytes?: number;
  now?: number;
}

export function generateCorpus(opts: CorpusOptions): SynthDoc[] {
  const r = rng(opts.seed ?? 42);
  const greekFraction = opts.greekFraction ?? 0.2;
  const vocabSize = opts.vocab ?? 30_000;
  const latin = makeVocab(vocabSize, r, false);
  const greek = greekFraction > 0 ? makeVocab(Math.floor(vocabSize / 2), r, true) : [];
  const pickLatin = zipf(latin.length, r);
  const pickGreek = greek.length ? zipf(greek.length, r) : () => 0;
  const domains = Array.from({ length: Math.max(20, Math.round(opts.pages / 40)) }, (_, i) => `${latin[(i * 7) % latin.length]}${i}.example`);
  const pickDomain = zipf(domains.length, r, 0.9);
  const mean = opts.meanBytes ?? 6000;
  const cap = opts.capBytes ?? 50_000;
  const now = opts.now ?? Date.UTC(2026, 9, 3);
  return Array.from({ length: opts.pages }, (_, id): SynthDoc => {
    const isGreek = r() < greekFraction;
    const vocab = isGreek ? greek : latin;
    const pick = isGreek ? pickGreek : pickLatin;
    const g = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    const bytes = Math.min(cap, Math.max(300, Math.round(mean * 0.65 * Math.exp(0.8 * g))));
    const parts: string[] = [];
    for (let len = 0; len < bytes; ) {
      const w = vocab[pick()] as string;
      parts.push(w);
      len += w.length + 1;
    }
    const words = (n: number) => Array.from({ length: n }, () => vocab[pick()]).join(' ');
    const domain = domains[pickDomain()] as string;
    return {
      url: `https://${domain}/p/${id}`, // ASCII path: normalizeUrl percent-encodes non-ASCII, which would break label matching
      domain,
      title: words(4 + Math.floor(r() * 4)),
      headings: words(6 + Math.floor(r() * 6)),
      description: words(12),
      body: parts.join(' '),
      lastVisit: now - Math.floor(r() * 365 * 86_400_000),
      visitCount: 1 + Math.floor(Math.exp(r() * 3)),
      greek: isGreek,
    };
  });
}
