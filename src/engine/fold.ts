// Text folding (ADR-002, M0 S9): NFD → strip Unicode combining marks → lowercase. SQLite's unicode61 `remove_diacritics`
// folds Latin but NOT Greek tonos/dialytika, so folding is done here, on indexed text AND on queries.

const MARKS = /\p{M}/gu;
const ASCII = /^\p{ASCII}*$/u;

/**
 * NFD → strip combining marks → lowercase, plus final sigma ς → σ. JS lower-casing picks ς by CONTEXT ("ΛΟΓΟΣ" → "λογος"
 * but a lone "Σ" → "σ"), which would make per-character folding (snippets) disagree with whole-string folding (index and
 * queries); mapping ς to σ makes folding context-free. (SQLite's tokenizer folds the two sigmas as well.)
 */
export function fold(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase(); // hot path: nothing to normalise or strip
  return text.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/ς/g, 'σ');
}

/** Folded text plus, for every UTF-16 unit of the folded output, the index of the original unit it came from. */
export interface FoldedText {
  text: string;
  /** map[i] = index in the original string of the character that produced folded[i]; map[text.length] = original length. */
  map: ArrayLike<number>;
}

/** folded form of each distinct non-ASCII character seen (a language uses only dozens of them) */
const CHAR_CACHE = new Map<string, string>();

/**
 * fold() plus an offset map back into the original (used to highlight in the ORIGINAL text). Hot path (called for every
 * result snippet): ASCII text, the common case, is lowercased in one pass with an identity map; only non-ASCII code points
 * are folded one by one.
 */
export function foldWithMap(original: string): FoldedText {
  if (ASCII.test(original)) {
    const map = new Uint32Array(original.length + 1);
    for (let i = 0; i <= original.length; i++) map[i] = i;
    return { text: original.toLowerCase(), map };
  }
  const parts: string[] = [];
  const map: number[] = [];
  let index = 0;
  for (const ch of original) {
    let folded = ch.charCodeAt(0) < 128 ? ch.toLowerCase() : CHAR_CACHE.get(ch);
    if (folded === undefined) {
      folded = fold(ch);
      if (CHAR_CACHE.size > 20_000) CHAR_CACHE.clear();
      CHAR_CACHE.set(ch, folded);
    }
    for (let i = 0; i < folded.length; i++) map.push(index);
    parts.push(folded);
    index += ch.length;
  }
  map.push(original.length);
  return { text: parts.join(''), map };
}

/** The token alphabet FTS5's unicode61 tokenizer indexes (letters and numbers; everything else separates tokens). */
export const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(foldedText: string): string[] {
  return foldedText.match(TOKEN_RE) ?? [];
}
