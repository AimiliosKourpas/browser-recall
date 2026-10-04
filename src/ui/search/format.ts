// Pure presentation helpers for the search UI (unit-tested).
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type RelativeTime = { unit: 'now' | 'minutes' | 'hours' | 'days' | 'months'; n: number };

export function relativeTime(timestamp: number, now: number): RelativeTime {
  const age = Math.max(0, now - timestamp);
  if (age < MIN) return { unit: 'now', n: 0 };
  if (age < HOUR) return { unit: 'minutes', n: Math.floor(age / MIN) };
  if (age < DAY) return { unit: 'hours', n: Math.floor(age / HOUR) };
  if (age < 60 * DAY) return { unit: 'days', n: Math.floor(age / DAY) };
  return { unit: 'months', n: Math.floor(age / (30 * DAY)) };
}

/** Domain and a shortened path for display; never throws. */
export function displayUrl(url: string, maxPath = 48): { domain: string; path: string } {
  try {
    const u = new URL(url);
    let path = decodeURIComponent(`${u.pathname}${u.search}`);
    if (path === '/') path = '';
    if ([...path].length > maxPath) path = `${[...path].slice(0, maxPath - 1).join('')}…`;
    return { domain: u.hostname.replace(/^www\./, ''), path };
  } catch {
    return { domain: url.slice(0, 60), path: '' };
  }
}

/** Letter avatar (no favicons: they need an extra permission, PRODUCT_SPEC §5.2): first letter + a stable hue. */
export function avatar(domain: string): { letter: string; hue: number } {
  const clean = domain.replace(/^www\./, '');
  let hash = 0;
  for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { letter: ([...clean][0] ?? '?').toUpperCase(), hue: hash % 360 };
}

/** Splits text into plain and highlighted pieces from [start, end) ranges (clamped, merged, sorted). Rendered as text nodes only. */
export function splitHighlights(text: string, ranges: [number, number][]): { text: string; mark: boolean }[] {
  const sorted = ranges
    .map(([s, e]): [number, number] => [Math.max(0, Math.min(s, text.length)), Math.max(0, Math.min(e, text.length))])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: text.slice(at, s), mark: false });
    out.push({ text: text.slice(s, e), mark: true });
    at = e;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false });
  return out.length ? out : [{ text, mark: false }];
}

/** Where opening a result goes: snippets reopen at the saved passage via their text-fragment (`#:~:text=…`). */
export function resultHref(r: { kind: 'page' | 'snippet'; url: string; fragment?: string | undefined }): string {
  return r.kind === 'snippet' && r.fragment ? `${r.url}${r.fragment.startsWith('#') ? '' : '#'}${r.fragment}` : r.url;
}
