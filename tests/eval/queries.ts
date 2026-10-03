// Labelled relevance queries over the synthetic corpus: {query, expected URL}. Generated deterministically so the set is
// reproducible without committing the corpus; tests/eval/queries.jsonl is a snapshot of it. Metrics: hit@1, hit@5, MRR.
import { fold, tokenize } from '../../src/engine/fold';
import type { SearchStore } from '../../src/engine/store';
import { rng, type SynthDoc } from '../support/corpus';

export type QueryKind = 'title' | 'body-two-words' | 'phrase' | 'site-and-word' | 'prefix' | 'greek-unaccented' | 'typo';
export interface LabelledQuery {
  kind: QueryKind;
  query: string;
  expectedUrl: string;
}

/** Document frequency of every folded token over title + headings + description + body (a word counts once per page). */
function documentFrequency(docs: SynthDoc[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(tokenize(fold(`${d.title} ${d.headings} ${d.description} ${d.body}`)))) df.set(w, (df.get(w) ?? 0) + 1);
  return df;
}

/**
 * Queries are built from words a person would plausibly remember about ONE page: distinctive enough that the source page is
 * the intended answer. "Distinctive" = low document frequency (<= maxDf pages), so the label is meaningful in word-salad text
 * where ordinary Zipf words occur everywhere. This turns the harness into a regression guard for the mechanics (folding,
 * prefix, phrase, filters, ranking), not a claim about real-world relevance.
 */
export function generateQueries(docs: SynthDoc[], perKind = 80, seed = 7): LabelledQuery[] {
  const r = rng(seed);
  const df = documentFrequency(docs);
  const out: LabelledQuery[] = [];
  const bodyWords = (d: SynthDoc, maxDf: number, minLen = 5) => [...new Set(tokenize(fold(d.body)))].filter((w) => (df.get(w) ?? 0) <= maxDf && [...w].length >= minLen);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const sample = (kind: QueryKind, wantGreek: boolean | undefined, make: (d: SynthDoc) => string | undefined) => {
    let made = 0;
    for (let tries = 0; made < perKind && tries < perKind * 100; tries++) {
      const d = docs[Math.floor(r() * docs.length)] as SynthDoc;
      if (wantGreek !== undefined && d.greek !== wantGreek) continue;
      const q = make(d);
      if (q) {
        out.push({ kind, query: q, expectedUrl: d.url });
        made++;
      }
    }
  };
  sample('title', undefined, (d) => {
    const w = d.title.split(' ').filter((x) => (df.get(fold(x)) ?? 0) <= 25);
    return w.length >= 2 ? `${w[0]} ${w[1]}` : undefined;
  });
  sample('body-two-words', undefined, (d) => {
    const w = bodyWords(d, 3);
    return w.length >= 2 ? `${pick(w)} ${pick(w)}` : undefined;
  });
  sample('phrase', false, (d) => {
    const t = d.body.split(' ');
    const i = Math.floor(r() * (t.length - 3));
    const [a, b] = [t[i] as string, t[i + 1] as string];
    return (df.get(fold(a)) ?? 0) <= 40 && (df.get(fold(b)) ?? 0) <= 40 ? `"${a} ${b}"` : undefined;
  });
  sample('site-and-word', undefined, (d) => {
    const w = bodyWords(d, 40);
    return w.length ? `${pick(w)} site:${d.domain}` : undefined;
  });
  const vocab = [...df.keys()];
  sample('prefix', undefined, (d) => {
    const w = bodyWords(d, 3, 7);
    if (!w.length) return undefined;
    const prefix = [...pick(w)].slice(0, 6).join('');
    return vocab.filter((v) => v.startsWith(prefix)).length <= 3 ? prefix : undefined; // the prefix itself must be selective
  });
  sample('greek-unaccented', true, (d) => {
    const w = bodyWords(d, 3);
    return w.length ? pick(w) : undefined; // folded text IS the accent-less form the user types
  });
  sample('typo', false, (d) => {
    const w = bodyWords(d, 3, 6);
    if (!w.length) return undefined;
    const word = pick(w);
    const i = 1 + Math.floor(r() * (word.length - 2));
    return word.slice(0, i) + word.slice(i + 1); // one deleted character
  });
  return out;
}

export interface KindMetrics {
  n: number;
  hit1: number;
  hit5: number;
  mrr: number;
  /** typo only: share of queries where the engine suggested the intended word */
  suggestionRate?: number;
}

export function evaluate(store: SearchStore, docs: SynthDoc[], queries: LabelledQuery[], now: number): Record<string, KindMetrics> {
  const byUrl = new Map(docs.map((d) => [d.url, d]));
  const acc = new Map<string, { n: number; h1: number; h5: number; rr: number; sug: number }>();
  for (const q of queries) {
    const resp = store.search({ query: q.query, now, limit: 50 });
    const rank = resp.results.findIndex((x) => x.url === q.expectedUrl) + 1;
    const a = acc.get(q.kind) ?? { n: 0, h1: 0, h5: 0, rr: 0, sug: 0 };
    a.n++;
    if (rank === 1) a.h1++;
    if (rank >= 1 && rank <= 5) a.h5++;
    if (rank >= 1) a.rr += 1 / rank;
    if (q.kind === 'typo') {
      const intended = tokenize(fold((byUrl.get(q.expectedUrl) as SynthDoc).body));
      if (resp.suggestions.some((s) => intended.includes(s.replacement))) a.sug++;
    }
    acc.set(q.kind, a);
  }
  const out: Record<string, KindMetrics> = {};
  const total = { n: 0, h1: 0, h5: 0, rr: 0 };
  for (const [kind, a] of acc) {
    out[kind] = { n: a.n, hit1: a.h1 / a.n, hit5: a.h5 / a.n, mrr: a.rr / a.n, ...(kind === 'typo' ? { suggestionRate: a.sug / a.n } : {}) };
    if (kind !== 'typo') {
      total.n += a.n;
      total.h1 += a.h1;
      total.h5 += a.h5;
      total.rr += a.rr;
    }
  }
  out['ALL (excluding typo)'] = { n: total.n, hit1: total.h1 / total.n, hit5: total.h5 / total.n, mrr: total.rr / total.n };
  return out;
}
