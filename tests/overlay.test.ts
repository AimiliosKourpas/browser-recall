import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { closeOverlay, openSearch, type OpenSearchDeps } from '../src/background/open-search';
import { applyInert, restoreInert } from '../src/overlay/inert';
import { isOverlayCommand, isOverlayLocation } from '../src/overlay/protocol';

const bodyOf = (html: string) => parseHTML(`<!doctype html><html><body${html}></body></html>`).document.body as unknown as HTMLElement;

describe('body.inert bookkeeping', () => {
  it('sets inert and restores an absent attribute exactly', () => {
    const body = bodyOf('');
    const snap = applyInert(body);
    expect(body.hasAttribute('inert')).toBe(true);
    restoreInert(snap);
    expect(body.hasAttribute('inert')).toBe(false);
  });
  it('restores a pre-existing inert attribute and its value exactly', () => {
    const body = bodyOf(' inert="x"');
    const snap = applyInert(body);
    expect(body.getAttribute('inert')).toBe('');
    restoreInert(snap);
    expect(body.getAttribute('inert')).toBe('x');
  });
  it('is safe to restore twice or with nothing to restore', () => {
    const body = bodyOf('');
    const snap = applyInert(body);
    restoreInert(snap);
    restoreInert(snap);
    restoreInert(undefined);
    expect(body.hasAttribute('inert')).toBe(false);
  });
});

describe('overlay protocol', () => {
  it('accepts only the two known commands', () => {
    expect(isOverlayCommand({ target: 'overlay', cmd: 'toggle' })).toBe(true);
    expect(isOverlayCommand({ target: 'overlay', cmd: 'close' })).toBe(true);
    for (const bad of [null, 'toggle', {}, { target: 'overlay', cmd: 'eval' }, { cmd: 'toggle' }, { target: 'x', cmd: 'close' }]) expect(isOverlayCommand(bad)).toBe(false);
  });
  it('recognises the overlay iframe by its query flag only', () => {
    expect(isOverlayLocation('?overlay=1')).toBe(true);
    expect(isOverlayLocation('')).toBe(false);
    expect(isOverlayLocation('?overlay=0')).toBe(false);
  });
});

function deps(over: Partial<OpenSearchDeps> = {}) {
  const calls: string[] = [];
  const d: OpenSearchDeps = {
    inject: async (id) => void calls.push(`inject:${id}`),
    send: async (id, cmd) => (calls.push(`send:${id}:${cmd}`), { ok: true, open: true }),
    openWindow: async () => void calls.push('window'),
    ...over,
  };
  return { d, calls };
}

describe('openSearch: overlay with guaranteed window fallback', () => {
  it('uses the overlay when injection and the host reply succeed', async () => {
    const { d, calls } = deps();
    expect(await openSearch({ id: 3, url: 'https://a.example/' }, d)).toBe('overlay');
    expect(calls).toEqual(['inject:3', 'send:3:toggle']);
  });
  it.each([
    ['no tab', undefined],
    ['tab without id', {}],
    ['chrome:// page', { id: 1, url: 'chrome://version' }],
    ['extension page', { id: 1, url: 'chrome-extension://abc/search.html' }],
    ['about:blank', { id: 1, url: 'about:blank' }],
  ])('goes straight to the window for %s (no injection attempt)', async (_n, tab) => {
    const { d, calls } = deps();
    expect(await openSearch(tab, d)).toBe('window');
    expect(calls).toEqual(['window']);
  });
  it('falls back to the window when injection throws', async () => {
    const { d, calls } = deps({ inject: async () => { throw new Error('Cannot access contents of the page'); } });
    expect(await openSearch({ id: 1, url: 'https://a.example/' }, d)).toBe('window');
    expect(calls).toEqual(['window']);
  });
  it('falls back when the host never answers, answers not-ok (page CSS won), or the message throws', async () => {
    for (const send of [async () => undefined, async () => ({ ok: false as const, reason: 'overlay not rendered' }), async () => { throw new Error('no receiver'); }]) {
      const { d, calls } = deps({ send });
      expect(await openSearch({ id: 1, url: 'https://a.example/' }, d)).toBe('window');
      expect(calls.at(-1)).toBe('window');
    }
  });
  it('still attempts pages whose URL is hidden (no tabs permission) and falls back on failure', async () => {
    const { d, calls } = deps({ inject: async () => { throw new Error('denied'); } });
    expect(await openSearch({ id: 9 }, d)).toBe('window');
    expect(calls).toEqual(['window']);
  });
  it('closeOverlay never throws (the page may be gone)', async () => {
    await expect(closeOverlay(1, { send: async () => { throw new Error('gone'); } })).resolves.toBeUndefined();
    await expect(closeOverlay(undefined, { send: async () => undefined })).resolves.toBeUndefined();
  });
});
