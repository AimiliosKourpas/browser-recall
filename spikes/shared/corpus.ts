// Deterministic synthetic corpus generator (generated text only, license-safe).
export interface Doc {
  id: number;
  url: string;
  domain: string;
  title: string;
  body: string;
  lastVisit: number; // epoch ms
  visitCount: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYL = ['ba', 'ko', 'ri', 'su', 'ten', 'la', 'mor', 'vi', 'dex', 'qua', 'pro', 'nal', 'ist', 'er', 'on', 'cal', 'fu', 'gra', 'hy', 'jo'];

export function makeVocab(size: number, rnd: () => number): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  while (words.length < size) {
    const n = 1 + Math.floor(rnd() * 4);
    let w = '';
    for (let i = 0; i < n; i++) w += SYL[Math.floor(rnd() * SYL.length)];
    if (!seen.has(w)) {
      seen.add(w);
      words.push(w);
    }
    // guarantee termination when syllable space is small
    if (seen.size > 0 && words.length < size && seen.size >= 20 ** 4) break;
  }
  let i = 0;
  while (words.length < size) words.push(`w${i++}x`);
  return words;
}

/** Zipf sampler via inverse CDF over rank^-s. */
export function zipfSampler(n: number, rnd: () => number, s = 1.05): () => number {
  const cdf = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += 1 / Math.pow(i + 1, s);
    cdf[i] = sum;
  }
  for (let i = 0; i < n; i++) cdf[i] /= sum;
  return () => {
    const u = rnd();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export interface CorpusOptions {
  pages: number;
  seed?: number;
  vocab?: number;
  meanBytes?: number; // typical readable-text size
  capBytes?: number;
  domains?: number;
  nowMs?: number;
}

export function generateCorpus(opts: CorpusOptions): Doc[] {
  const rnd = mulberry32(opts.seed ?? 42);
  const vocab = makeVocab(opts.vocab ?? 30000, rnd);
  const word = zipfSampler(vocab.length, rnd);
  const domainCount = opts.domains ?? Math.max(50, Math.round(opts.pages / 40));
  const domains = Array.from({ length: domainCount }, (_, i) => `${vocab[(i * 7) % vocab.length]}${i}.example`);
  const domPick = zipfSampler(domainCount, rnd, 0.9);
  const mean = opts.meanBytes ?? 6000;
  const cap = opts.capBytes ?? 50_000;
  const now = opts.nowMs ?? Date.UTC(2026, 9, 3);
  const docs: Doc[] = [];
  for (let id = 0; id < opts.pages; id++) {
    // lognormal-ish length, mean ~ `mean`
    const g = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const bytes = Math.min(cap, Math.max(300, Math.round(mean * 0.65 * Math.exp(0.8 * g))));
    const parts: string[] = [];
    let len = 0;
    while (len < bytes) {
      const w = vocab[word()];
      parts.push(w);
      len += w.length + 1;
    }
    const title = Array.from({ length: 4 + Math.floor(rnd() * 5) }, () => vocab[word()]).join(' ');
    const domain = domains[domPick()];
    docs.push({
      id,
      url: `https://${domain}/p/${id}/${vocab[word()]}`,
      domain,
      title,
      body: parts.join(' '),
      lastVisit: now - Math.floor(rnd() * 365 * 86400_000),
      visitCount: 1 + Math.floor(Math.exp(rnd() * 3)),
    });
  }
  return docs;
}

/** Queries drawn the way a user would: 1-3 mid-frequency words from a random doc. */
export function generateQueries(docs: Doc[], n: number, seed = 7, mode: 'distinctive' | 'frequency' = 'frequency'): string[] {
  const rnd = mulberry32(seed);
  // "distinctive" = words outside the 300 most frequent corpus words (what a user remembers about a page);
  // "frequency" = raw sampling by occurrence, i.e. adversarial stop-word-like queries.
  const common = new Set<string>();
  if (mode === 'distinctive') {
    const counts = new Map<string, number>();
    for (const d of docs.slice(0, 300)) for (const w of d.body.split(' ')) counts.set(w, (counts.get(w) ?? 0) + 1);
    for (const [w] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 300)) common.add(w);
  }
  const pickWord = (words: string[]): string => {
    for (let tries = 0; tries < 50; tries++) {
      const w = words[Math.floor(rnd() * words.length)];
      if (!common.has(w)) return w;
    }
    return words[0];
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = docs[Math.floor(rnd() * docs.length)];
    const words = d.body.split(' ');
    const k = 1 + Math.floor(rnd() * 3);
    const q: string[] = [];
    for (let j = 0; j < k; j++) q.push(pickWord(words));
    // last term sometimes as a typed prefix
    if (rnd() < 0.5) {
      const last = q[q.length - 1];
      q[q.length - 1] = last.slice(0, Math.max(3, Math.ceil(last.length * 0.7)));
    }
    out.push(q.join(' '));
  }
  return out;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
