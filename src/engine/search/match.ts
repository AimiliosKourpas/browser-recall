// Builds FTS5 MATCH expressions from a parsed query. The grammar produced is CLOSED: double-quoted groups of folded
// alphanumeric tokens, an optional trailing `*`, joined by spaces (AND) or OR. No user character other than [\p{L}\p{N}]
// and spaces can reach the expression, and the expression is bound as a statement parameter, never concatenated into SQL.
import type { Positive } from './parser';

const group = (tokens: string[], prefix: boolean): string => `"${tokens.join(' ')}"${prefix ? '*' : ''}`;

/** All positives required; the last bare (unquoted) positive also matches as a prefix (typing-friendly). Undefined if no positives. */
export function buildMatch(positives: Positive[]): string | undefined {
  if (positives.length === 0) return undefined;
  const lastIndex = positives.length - 1;
  return positives.map((p, i) => group(p.tokens, i === lastIndex && !p.quoted)).join(' ');
}

/** Relaxation: any single token of length >= 3 from any positive (OR). Undefined if no token qualifies. */
export function buildAnyMatch(positives: Positive[]): string | undefined {
  const tokens = [...new Set(positives.flatMap((p) => p.tokens).filter((t) => [...t].length >= 3))];
  if (tokens.length === 0) return undefined;
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

/** Exclusions as one OR expression, used with a rowid NOT IN subquery. Undefined if none. */
export function buildExcludeMatch(excludes: string[][]): string | undefined {
  if (excludes.length === 0) return undefined;
  return excludes.map((tokens) => group(tokens, false)).join(' OR ');
}

/** Trigram substring probe for titles/URLs: needs >= 3 characters after folding. */
export function buildTrigramMatch(foldedQuery: string): string | undefined {
  const s = foldedQuery.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return [...s.replace(/ /g, '')].length >= 3 ? `"${s}"` : undefined;
}
