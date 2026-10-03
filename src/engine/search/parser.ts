// Query parser (PRODUCT_SPEC §5.2): hand-written, total (never throws), produces an AST. User text NEVER becomes SQL:
// the AST holds only folded alphanumeric tokens, domains and numbers; see match.ts for the closed FTS grammar built from it.
import { fold, tokenize } from '../fold';
import { parseDateValue, parseWhen, type DateContext } from './dates';

export interface Positive {
  /** folded alphanumeric tokens (>= 1). More than one token = phrase (explicit quotes, or a word like "foo-bar"). */
  tokens: string[];
  quoted: boolean;
}

export interface ParsedQuery {
  raw: string;
  positives: Positive[];
  excludes: string[][];
  sites: string[];
  excludeSites: string[];
  after?: number;
  before?: number;
  isSaved: boolean;
  isSnippet: boolean;
}

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$|^localhost$/;

interface Piece {
  text: string;
  quoted: boolean;
  negated: boolean;
}

/** Splits into words and "quoted phrases"; a leading '-' negates. An unterminated quote swallows the rest of the input. */
function pieces(input: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < input.length) {
    while (i < input.length && /\s/u.test(input[i] as string)) i++;
    if (i >= input.length) break;
    let negated = false;
    if (input[i] === '-' && i + 1 < input.length && !/\s/u.test(input[i + 1] as string)) {
      negated = true;
      i++;
    }
    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1);
      const text = end === -1 ? input.slice(i + 1) : input.slice(i + 1, end);
      out.push({ text, quoted: true, negated });
      i = end === -1 ? input.length : end + 1;
    } else {
      let j = i;
      while (j < input.length && !/\s/u.test(input[j] as string)) j++;
      out.push({ text: input.slice(i, j), quoted: false, negated });
      i = j;
    }
  }
  return out;
}

function normalizeDomain(value: string): string | undefined {
  const d = fold(value).replace(/^\.+|\.+$/g, '').replace(/^www\./, '');
  return DOMAIN_RE.test(d) ? d : undefined;
}

export function parseQuery(input: string, ctx: DateContext): ParsedQuery {
  const q: ParsedQuery = { raw: input, positives: [], excludes: [], sites: [], excludeSites: [], isSaved: false, isSnippet: false };
  for (const piece of pieces(input)) {
    if (!piece.quoted) {
      const op = /^([a-z]+):(.*)$/i.exec(piece.text);
      if (op && applyOperator((op[1] as string).toLowerCase(), op[2] as string, piece.negated, q, ctx)) continue;
    }
    // literal text: a word, a quoted phrase, or an invalid operator kept as plain words
    const tokens = tokenize(fold(piece.text));
    if (tokens.length === 0) continue; // pure punctuation
    if (piece.negated) q.excludes.push(tokens);
    else q.positives.push({ tokens, quoted: piece.quoted });
  }
  return q;
}

/** Returns true if the operator was valid and consumed; false to treat the piece as literal text. */
function applyOperator(key: string, value: string, negated: boolean, q: ParsedQuery, ctx: DateContext): boolean {
  switch (key) {
    case 'site': {
      const domain = normalizeDomain(value);
      if (!domain) return false;
      (negated ? q.excludeSites : q.sites).push(domain);
      return true;
    }
    case 'after':
    case 'before': {
      if (negated) return false;
      const at = parseDateValue(value, ctx);
      if (at === undefined) return false;
      if (key === 'after') q.after = at;
      else q.before = at;
      return true;
    }
    case 'when': {
      if (negated) return false;
      const range = parseWhen(value, ctx);
      if (!range) return false;
      if (range.after !== undefined) q.after = range.after;
      if (range.before !== undefined) q.before = range.before;
      return true;
    }
    case 'is': {
      if (negated) return false;
      const v = value.toLowerCase();
      if (v === 'saved') q.isSaved = true;
      else if (v === 'snippet') q.isSnippet = true;
      else return false;
      return true;
    }
    default:
      return false;
  }
}
