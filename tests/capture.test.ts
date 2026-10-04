import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { extractPage, type ExtractOptions, type ExtractResult } from '../src/capture/extractor';
import { buildTextFragment } from '../src/capture/text-fragment';

const opts = (o: Partial<ExtractOptions> = {}): ExtractOptions => ({ deep: false, minTextLength: 0, ...o });
const wrap = (html: string): string => (/<html/i.test(html) ? html : `<!doctype html><html><head><title>t</title></head>${html}</html>`);
function extract(html: string, o: Partial<ExtractOptions> = {}): ExtractResult {
  const { document } = parseHTML(wrap(html));
  (globalThis as { document?: unknown }).document = document;
  try {
    return extractPage(opts(o));
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
}
const ok = (r: ExtractResult) => {
  if (!r.ok) throw new Error(`skipped: ${r.reason}`);
  return r;
};

describe('extractPage (injected, self-contained)', () => {
  it('takes the main content, drops scripts/nav/footer/forms/hidden text, keeps title, description, headings, language', () => {
    const r = ok(
      extract(`<!doctype html><html lang="en"><head><title>  The   Title </title><meta name="description" content="A short description"><script>var secret = 1;</script><style>.x{}</style></head>
      <body><nav>Home About</nav><header>Site header</header>
      <main><h1>Main heading</h1><p>First paragraph with <b>bold</b> text.</p><div hidden>hidden text</div><p style="display: none">also hidden</p><h2>Sub heading</h2><p>Second paragraph.</p><button>Click</button></main>
      <aside>Related links</aside><footer>Copyright</footer><script>track()</script></body></html>`),
    );
    expect(r.title).toBe('The Title');
    expect(r.description).toBe('A short description');
    expect(r.lang).toBe('en');
    expect(r.headings).toBe('Main heading · Sub heading');
    expect(r.text).toContain('First paragraph with bold text.');
    expect(r.text).toContain('Second paragraph.');
    for (const bad of ['Home About', 'Site header', 'hidden text', 'also hidden', 'Related links', 'Copyright', 'secret', 'track()', 'Click']) expect(r.text).not.toContain(bad);
  });
  it('falls back to the body when there is no main/article, and keeps Greek text and accents intact', () => {
    const r = ok(extract('<html lang="el"><head><title>Βιβλίο</title></head><body><p>Το καλύτερο βιβλίο για ΖΑΧΑΡΩΤΑ γλυκά.</p></body></html>'));
    expect(r.text).toBe('Το καλύτερο βιβλίο για ΖΑΧΑΡΩΤΑ γλυκά.');
    expect(r.lang).toBe('el');
  });
  it('separates blocks with spaces (no glued words) and collapses whitespace', () => {
    const r = ok(extract('<body><p>alpha</p><p>beta</p><ul><li>one</li><li>two</li></ul>a<br>b\n\n   c</body>'));
    expect(r.text).toBe('alpha beta one two a b c');
  });
  it('caps text at 50 KB and flags truncation; collapses runaway repeated tokens and strips control characters', () => {
    const big = ok(extract(`<body><p>${Array.from({ length: 30_000 }, (_, i) => `word${i}`).join(' ')}</p></body>`));
    const small = ok(extract(`<body><p>${'lorem ipsum dolor '.repeat(5000)}</p></body>`)); // repeated phrase: kept, only single-token runs are collapsed
    expect(big.text.length).toBeLessThanOrEqual(50_000);
    expect(small.text.length).toBeLessThanOrEqual(50_000);
    expect(big.truncated || small.truncated).toBe(true);
    const spam = ok(extract(`<body><p>buy ${'cheap '.repeat(500)}now</p></body>`));
    expect(spam.text).toBe('buy cheap now');
    const ctl = ok(extract('<body><p>a\u0000b\u0007c​d﻿e</p></body>'));
    expect(ctl.text).toBe('a b c d e');
  });
  it('Deep Search mode skips pages with password or payment-card fields; explicit Remember does not', () => {
    const login = '<body><form><input type="password"></form><p>welcome back, text text text</p></body>';
    expect(extract(login, { deep: true })).toEqual({ ok: false, reason: 'password-field' });
    expect(ok(extract(login, { deep: false })).text).toContain('welcome back');
    expect(extract('<body><input autocomplete="cc-number"><p>pay now</p></body>', { deep: true })).toEqual({ ok: false, reason: 'payment-field' });
  });
  it('reports too little text (title-only) and respects the minimum length', () => {
    expect(extract('<body><p>hi</p></body>', { minTextLength: 50 })).toEqual({ ok: false, reason: 'too-little-text' });
    expect(extract('<body></body>', { minTextLength: 1 })).toEqual({ ok: false, reason: 'too-little-text' });
    expect(ok(extract('<body></body>', { minTextLength: 0 })).text).toBe('');
  });
  it('is read-only: the document is not modified', () => {
    const html = '<body><main><p>keep me</p><script>x()</script></main></body>';
    const { document } = parseHTML(wrap(html));
    const before = document.documentElement.outerHTML;
    (globalThis as { document?: unknown }).document = document;
    extractPage(opts());
    delete (globalThis as { document?: unknown }).document;
    expect(document.documentElement.outerHTML).toBe(before);
  });
});

describe('text fragments', () => {
  it('encodes a short selection (spaces, punctuation, hyphen, unicode)', () => {
    expect(buildTextFragment('to be, or not to be')).toBe('#:~:text=to%20be%2C%20or%20not%20to%20be');
    expect(buildTextFragment('well-known (really)!')).toBe('#:~:text=well%2Dknown%20%28really%29%21');
    expect(buildTextFragment('Λόγος & Αρετή')).toBe(`#:~:text=${encodeURIComponent('Λόγος & Αρετή')}`);
  });
  it('normalises whitespace and rejects empty selections', () => {
    expect(buildTextFragment('  a \n\n b\t c  ')).toBe('#:~:text=a%20b%20c');
    expect(buildTextFragment('   \n ')).toBeUndefined();
    expect(buildTextFragment('')).toBeUndefined();
  });
  it('long selections use the start,end form with limited edges', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`);
    const f = buildTextFragment(words.join(' ')) ?? '';
    expect(f).toMatch(/^#:~:text=[^,]+,[^,]+$/);
    expect(f).toContain('w0%20w1');
    expect(f).toContain('w198%20w199');
    expect(f.length).toBeLessThan(200);
    expect(buildTextFragment('x'.repeat(1000))?.length).toBeLessThan(400); // one huge "word"
  });
});
