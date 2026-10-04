// Page text extractor. Injected with chrome.scripting.executeScript({ func: extractPage, args: [options] }), so it MUST be one
// self-contained function (it is serialised: no imports, no outer references). It only READS the DOM: never modifies it, never
// reads cookies/storage/form values, never makes requests (ARCHITECTURE §6). Layout-free (textContent traversal) so it also runs
// against a linkedom document in unit tests; real browsers additionally use checkVisibility() to skip hidden subtrees.
export interface ExtractOptions {
  /** Deep Search mode: also apply the sensitive-page skip rules (password / payment-card fields, non-HTML). Explicit Remember passes false. */
  deep: boolean;
  minTextLength: number;
}

export type ExtractResult =
  | { ok: true; title: string; description: string; headings: string; text: string; lang: string; truncated: boolean }
  | { ok: false; reason: 'not-html' | 'password-field' | 'payment-field' | 'too-little-text' };

export function extractPage(options: ExtractOptions): ExtractResult {
  const BODY_CAP = 50_000;
  const HEADINGS_CAP = 5_000;
  const DESCRIPTION_CAP = 1_000;
  const doc = document;
  if (doc.contentType && !/html/i.test(doc.contentType)) return { ok: false, reason: 'not-html' };

  if (options.deep) {
    if (doc.querySelector('input[type="password"]')) return { ok: false, reason: 'password-field' };
    if (doc.querySelector('input[autocomplete^="cc-"], input[autocomplete="cc-number"]')) return { ok: false, reason: 'payment-field' };
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'NAV', 'ASIDE', 'FOOTER', 'HEADER', 'FORM', 'SELECT', 'OPTION', 'BUTTON', 'INPUT', 'TEXTAREA', 'DIALOG']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'BR', 'FIGURE', 'FIGCAPTION', 'DD', 'DT', 'DL', 'SUMMARY', 'DETAILS']);
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

  const clean = (s: string): string => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  const isHidden = (el: Element): boolean => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true;
    const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase();
    if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
    const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    return typeof check === 'function' ? !check.call(el, { visibilityProperty: true }) : false;
  };

  const root = doc.querySelector('main, article, [role="main"]') ?? doc.body ?? doc.documentElement;
  const parts: string[] = [];
  let length = 0;
  let truncated = false;
  const walk = (node: Node): void => {
    if (truncated) return;
    if (node.nodeType === 3) {
      const t = (node.nodeValue ?? '').replace(CONTROL, ' ');
      if (t.trim()) {
        parts.push(t);
        length += t.length;
        if (length > BODY_CAP * 2) truncated = true; // stop reading huge pages early; exact cap applied below
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) && !(el === root)) return;
    if (isHidden(el)) return;
    const block = BLOCK.has(tag);
    if (block) parts.push(' ');
    for (let child = el.firstChild; child; child = child.nextSibling) walk(child);
    if (block) parts.push(' ');
  };
  walk(root);

  let text = clean(parts.join(''));
  // anti-poisoning: collapse a token repeated more than 3 times in a row
  text = text.replace(/(^|\s)(\S{1,40})(?:\s+\2){3,}(?=\s|$)/g, '$1$2');
  if (text.length > BODY_CAP) {
    truncated = true;
    text = text.slice(0, BODY_CAP);
  }
  if (text.length < options.minTextLength) return { ok: false, reason: 'too-little-text' };

  const headings = clean(
    Array.from(root.querySelectorAll('h1, h2, h3'))
      .filter((h) => !isHidden(h))
      .map((h) => h.textContent ?? '')
      .join(' · '),
  ).slice(0, HEADINGS_CAP);
  const meta = (name: string): string => doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content') ?? '';
  return {
    ok: true,
    title: clean(doc.title || '').slice(0, 500),
    description: clean(meta('description') || meta('og:description')).slice(0, DESCRIPTION_CAP),
    headings,
    text,
    lang: (doc.documentElement.getAttribute('lang') ?? '').slice(0, 35),
    truncated,
  };
}
