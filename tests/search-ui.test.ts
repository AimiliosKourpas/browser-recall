import { describe, expect, it } from 'vitest';
import { avatar, displayUrl, relativeTime, resultHref, splitHighlights } from '../src/ui/search/format';
import { actionForKey, moveIndex, toggleToken, type KeyInput } from '../src/ui/search/keys';

const key = (k: string, o: Partial<KeyInput> = {}): KeyInput => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, ...o });

describe('search UI keyboard map', () => {
  it('arrows move only when there are results; Enter variants open as specified', () => {
    expect(actionForKey(key('ArrowDown'), true)).toEqual({ kind: 'move', delta: 1 });
    expect(actionForKey(key('ArrowUp'), true)).toEqual({ kind: 'move', delta: -1 });
    expect(actionForKey(key('ArrowDown'), false)).toEqual({ kind: 'none' });
    expect(actionForKey(key('Enter'), true)).toEqual({ kind: 'open', active: true, closeWindow: true });
    expect(actionForKey(key('Enter', { shiftKey: true }), true)).toEqual({ kind: 'open', active: true, closeWindow: true });
    expect(actionForKey(key('Enter', { ctrlKey: true }), true)).toEqual({ kind: 'open', active: false, closeWindow: false });
    expect(actionForKey(key('Enter', { metaKey: true }), true)).toEqual({ kind: 'open', active: false, closeWindow: false });
    expect(actionForKey(key('Enter'), false)).toEqual({ kind: 'none' });
    expect(actionForKey(key('Escape'), false)).toEqual({ kind: 'close' });
    expect(actionForKey(key('k', { ctrlKey: true }), true)).toEqual({ kind: 'focus-filters' });
    expect(actionForKey(key('k'), true)).toEqual({ kind: 'none' });
  });
  it('Enter during IME composition never opens a result (Greek, Japanese, Chinese…)', () => {
    expect(actionForKey(key('Enter', { isComposing: true }), true)).toEqual({ kind: 'none' });
    expect(actionForKey(key('Process'), true)).toEqual({ kind: 'none' });
    expect(actionForKey(key('ArrowDown', { isComposing: true }), true)).toEqual({ kind: 'none' });
  });
  it('moveIndex wraps in both directions and survives empty lists', () => {
    expect(moveIndex(0, -1, 5)).toBe(4);
    expect(moveIndex(4, 1, 5)).toBe(0);
    expect(moveIndex(2, 1, 5)).toBe(3);
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
  it('toggleToken adds, removes and replaces within an exclusive group', () => {
    expect(toggleToken('rust', 'is:saved')).toBe('rust is:saved');
    expect(toggleToken('rust is:saved', 'is:saved')).toBe('rust');
    expect(toggleToken('rust when:week', 'when:today', ['when:week', 'when:month'])).toBe('rust when:today');
    expect(toggleToken('', 'when:week')).toBe('when:week');
  });
});

describe('search UI formatting', () => {
  const now = Date.UTC(2026, 9, 3, 12);
  it('relative time buckets', () => {
    expect(relativeTime(now - 5_000, now)).toEqual({ unit: 'now', n: 0 });
    expect(relativeTime(now - 5 * 60_000, now)).toEqual({ unit: 'minutes', n: 5 });
    expect(relativeTime(now - 3 * 3_600_000, now)).toEqual({ unit: 'hours', n: 3 });
    expect(relativeTime(now - 3 * 86_400_000, now)).toEqual({ unit: 'days', n: 3 });
    expect(relativeTime(now - 90 * 86_400_000, now)).toEqual({ unit: 'months', n: 3 });
    expect(relativeTime(now + 1000, now)).toEqual({ unit: 'now', n: 0 });
  });
  it('displayUrl shortens the path, strips www, decodes, never throws', () => {
    expect(displayUrl('https://www.example.com/')).toEqual({ domain: 'example.com', path: '' });
    expect(displayUrl('https://a.example/p%20q?x=1')).toEqual({ domain: 'a.example', path: '/p q?x=1' });
    expect(displayUrl(`https://a.example/${'x'.repeat(100)}`).path.endsWith('…')).toBe(true);
    expect(displayUrl('not a url').domain).toBe('not a url');
  });
  it('avatar is stable and uses the first letter', () => {
    expect(avatar('www.github.com')).toEqual(avatar('github.com'));
    expect(avatar('github.com').letter).toBe('G');
    expect(avatar('').letter).toBe('?');
  });
  it('splitHighlights clamps, merges and sorts ranges and never loses text', () => {
    const parts = splitHighlights('hello world', [[6, 11], [0, 2], [1, 3], [50, 60], [4, 4]]);
    expect(parts.map((p) => p.text).join('')).toBe('hello world');
    expect(parts.filter((p) => p.mark).map((p) => p.text)).toEqual(['hel', 'world']);
    expect(splitHighlights('abc', [])).toEqual([{ text: 'abc', mark: false }]);
    expect(splitHighlights('', [[0, 3]])).toEqual([{ text: '', mark: false }]);
  });
  it('snippet results reopen at the saved passage; pages open plainly', () => {
    expect(resultHref({ kind: 'snippet', url: 'https://a.example/x', fragment: '#:~:text=hi' })).toBe('https://a.example/x#:~:text=hi');
    expect(resultHref({ kind: 'snippet', url: 'https://a.example/x', fragment: ':~:text=hi' })).toBe('https://a.example/x#:~:text=hi');
    expect(resultHref({ kind: 'page', url: 'https://a.example/x', fragment: '#:~:text=hi' })).toBe('https://a.example/x');
  });
});
