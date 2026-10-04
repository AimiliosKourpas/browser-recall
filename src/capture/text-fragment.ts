// Text-fragment links (`#:~:text=`) so a saved snippet reopens with the passage highlighted (PRODUCT_SPEC §5.4).
// Pure. Chrome highlights the first match; if the page no longer contains the passage it simply opens the page.
const MAX_FULL = 300; // longer selections use the `start,end` form (Chrome matches everything between)
const EDGE_WORDS = 6;

const encodePart = (s: string): string =>
  encodeURIComponent(s).replace(/[-!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`); // '-' separates prefix/suffix in the directive

/** Returns `#:~:text=...` or undefined when the selection has no usable text. */
export function buildTextFragment(selection: string): string | undefined {
  const text = selection.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if ([...text].length <= MAX_FULL) return `#:~:text=${encodePart(text)}`;
  const words = text.split(' ');
  if (words.length < EDGE_WORDS * 2 + 1) return `#:~:text=${encodePart([...text].slice(0, MAX_FULL).join(''))}`; // one very long "word": use its start
  const start = words.slice(0, EDGE_WORDS).join(' ');
  const end = words.slice(-EDGE_WORDS).join(' ');
  return `#:~:text=${encodePart(start)},${encodePart(end)}`;
}
