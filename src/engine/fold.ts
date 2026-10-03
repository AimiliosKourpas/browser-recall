// Text folding (ADR-002, M0 S9): NFD → strip Unicode combining marks → lowercase. SQLite's unicode61 `remove_diacritics`
// folds Latin but NOT Greek tonos/dialytika, so folding is done here, on indexed text AND on queries.

const MARKS = /\p{M}/gu;

export function fold(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').toLowerCase();
}

/** Folded text plus, for every UTF-16 unit of the folded output, the index of the original unit it came from. */
export interface FoldedText {
  text: string;
  /** map[i] = index in the original string of the character that produced folded[i]; map[text.length] = original length. */
  map: number[];
}

export function foldWithMap(original: string): FoldedText {
  let text = '';
  const map: number[] = [];
  let index = 0;
  for (const ch of original) {
    const folded = fold(ch);
    for (let i = 0; i < folded.length; i++) map.push(index);
    text += folded;
    index += ch.length;
  }
  map.push(original.length);
  return { text, map };
}

/** The token alphabet FTS5's unicode61 tokenizer indexes (letters and numbers; everything else separates tokens). */
export const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(foldedText: string): string[] {
  return foldedText.match(TOKEN_RE) ?? [];
}
