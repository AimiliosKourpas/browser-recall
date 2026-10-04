// Messages between the service worker and the injected overlay host (isolated world of the page). The host trusts only messages from
// this extension's own service worker (sender.id === runtime.id and no sender.tab); the page itself can never message the host.
export type OverlayCommand = { target: 'overlay'; cmd: 'toggle' | 'close' };
export type OverlayReply = { ok: true; open: boolean } | { ok: false; reason: string };

export const isOverlayCommand = (raw: unknown): raw is OverlayCommand => {
  if (typeof raw !== 'object' || raw === null) return false;
  const m = raw as Record<string, unknown>;
  return m.target === 'overlay' && (m.cmd === 'toggle' || m.cmd === 'close');
};

/** the search page runs in the overlay iframe when loaded with this query flag */
export const OVERLAY_FLAG = 'overlay=1';
export const isOverlayLocation = (search: string): boolean => new URLSearchParams(search).get('overlay') === '1';
