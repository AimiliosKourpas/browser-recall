// Ranking (ARCHITECTURE §5.3): score = a·norm(bm25) + b·titleOrUrlHit + c·recency + d·log1p(visits) + e·isSaved + f·phraseHit.
// Every component is a small pure function with its own test. Weights are starting values, tuned against docs/eval (not by feel).

export const WEIGHTS = { bm25: 1.0, titleUrl: 0.35, recency: 0.25, visits: 0.08, saved: 0.2, phrase: 0.2 } as const;
export const RECENCY_TAU_DAYS = 45;
const DAY = 86_400_000;

/**
 * SQLite bm25() returns smaller (more negative) = better. Maps to (0,1] relative to the BEST candidate (best = 1), so two
 * near-equal documents stay near-equal and the other ranking components can break the tie. (Min-max scaling blew tiny
 * differences up to the full range and drowned the saved/recency boosts.) All-zero or empty input → 1.
 */
export function normalizeBm25(raw: number[]): number[] {
  const strength = raw.map((v) => Math.max(0, -v));
  const best = Math.max(0, ...strength);
  return strength.map((v) => (best === 0 ? 1 : v / best));
}

/** 1 if every query token occurs in the folded title or URL as a whole word / word prefix, 0.5 if some do, else 0. */
export function titleUrlHit(tokens: string[], foldedTitleTokens: string[], foldedUrlTokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = [...foldedTitleTokens, ...foldedUrlTokens];
  let hits = 0;
  for (const t of tokens) if (haystack.some((h) => h === t || h.startsWith(t))) hits++;
  return hits === tokens.length ? 1 : hits > 0 ? 0.5 : 0;
}

export function recency(lastVisitMs: number, nowMs: number): number {
  const ageDays = Math.max(0, nowMs - lastVisitMs) / DAY;
  return Math.exp(-ageDays / RECENCY_TAU_DAYS);
}

export function visitBoost(visitCount: number): number {
  return Math.log1p(Math.max(0, visitCount));
}

/** 1 if the consecutive token sequence of any multi-token positive appears in the page's folded title or body prefix. */
export function phraseHit(phrases: string[][], foldedText: string): number {
  const multi = phrases.filter((p) => p.length > 1);
  if (multi.length === 0) return 0;
  return multi.every((p) => foldedText.includes(p.join(' '))) ? 1 : 0;
}

export interface ScoreInput {
  bm25Norm: number;
  titleUrl: number;
  recency: number;
  visits: number;
  saved: boolean;
  phrase: number;
}

export function combine(i: ScoreInput): number {
  return WEIGHTS.bm25 * i.bm25Norm + WEIGHTS.titleUrl * i.titleUrl + WEIGHTS.recency * i.recency + WEIGHTS.visits * i.visits + (i.saved ? WEIGHTS.saved : 0) + WEIGHTS.phrase * i.phrase;
}
