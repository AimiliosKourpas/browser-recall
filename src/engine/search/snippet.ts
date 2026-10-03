// Result snippets built in TypeScript from the stored ORIGINAL text (A1: FTS5 snippet() is ~10× too slow at 20K pages).
// Deterministic: same input → same window. Highlights are offsets into the returned text, so the UI renders text nodes only.
import { TOKEN_RE, foldWithMap } from '../fold';

export interface Snippet {
  text: string;
  /** [start, end) offsets into `text` */
  highlights: [number, number][];
}

export interface SnippetOptions {
  maxLength?: number; // default 180
  lead?: number; // characters of context before the first matched word, default 50
}

interface Match {
  start: number; // offsets in the ORIGINAL text
  end: number;
  term: number; // index of the query term it matched
}

/**
 * Tokens of `original` that equal a query term (or start with it, for the term flagged as prefix). Offsets refer to the
 * original text via the fold map, so Greek/Latin accents and capitalisation are preserved in the output.
 */
function findMatches(original: string, terms: string[], prefixTermIndex: number, limit: number): Match[] {
  const { text, map } = foldWithMap(original);
  const matches: Match[] = [];
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m !== null && matches.length < limit; m = TOKEN_RE.exec(text)) {
    const token = m[0];
    for (let t = 0; t < terms.length; t++) {
      const term = terms[t] as string;
      if (token === term || (t === prefixTermIndex && token.startsWith(term))) {
        matches.push({ start: map[m.index] as number, end: map[m.index + token.length] as number, term: t });
        break;
      }
    }
  }
  return matches;
}

/**
 * @param terms folded query tokens (positives flattened, in order)
 * @param prefixTermIndex index in `terms` that matches as a prefix, or -1
 * Returns undefined when the text is empty or nothing matches (callers fall back to a title/URL match line).
 */
export function buildSnippet(original: string, terms: string[], prefixTermIndex: number, opts: SnippetOptions = {}): Snippet | undefined {
  if (!original || terms.length === 0) return undefined;
  const maxLength = opts.maxLength ?? 180;
  const lead = opts.lead ?? 50;
  const matches = findMatches(original, terms, prefixTermIndex, 200);
  if (matches.length === 0) return undefined;

  // choose the window start (a match position minus lead) that covers the most DISTINCT terms; ties → earliest
  let best: { from: number; distinct: number } | undefined;
  for (const m of matches) {
    const from = Math.max(0, m.start - lead);
    const to = from + maxLength;
    const distinct = new Set(matches.filter((x) => x.start >= from && x.end <= to).map((x) => x.term)).size;
    if (!best || distinct > best.distinct) best = { from, distinct };
    if (best.distinct === new Set(terms.map((_, i) => i)).size) break;
  }
  let from = (best as { from: number }).from;
  let to = Math.min(original.length, from + maxLength);

  // snap to word boundaries so we never cut a word (unless a single "word" is longer than the window)
  if (from > 0) {
    const space = original.indexOf(' ', from);
    if (space !== -1 && space < from + 20) from = space + 1;
  }
  if (to < original.length) {
    const space = original.lastIndexOf(' ', to);
    if (space > from + maxLength / 2) to = space;
  }
  // never split a surrogate pair
  if (from > 0 && /[\uDC00-\uDFFF]/.test(original[from] as string)) from++;
  if (to < original.length && /[\uD800-\uDBFF]/.test(original[to - 1] as string)) to--;

  const slice = original.slice(from, to).replace(/\s+/g, ' ');
  // collapsing whitespace changes offsets: recompute highlights on the slice itself
  const inner = findMatches(slice, terms, prefixTermIndex, 200);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < original.length ? '…' : '';
  return {
    text: `${prefix}${slice.trim() === slice ? slice : slice.trim()}${suffix}`,
    highlights: normalizeHighlights(inner, slice, prefix.length),
  };
}

function normalizeHighlights(matches: Match[], slice: string, offset: number): [number, number][] {
  const lead = slice.length - slice.trimStart().length;
  return matches
    .map((m): [number, number] => [m.start - lead + offset, m.end - lead + offset])
    .filter(([s, e]) => s >= offset && e > s)
    .sort((a, b) => a[0] - b[0]);
}

/** Highlight ranges for short fields (titles, URLs). Offsets index into `text`. */
export function highlightRanges(text: string, terms: string[], prefixTermIndex: number): [number, number][] {
  return findMatches(text, terms, prefixTermIndex, 50).map((m): [number, number] => [m.start, m.end]);
}
