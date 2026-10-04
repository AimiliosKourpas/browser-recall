// Opens the search surface: the in-page overlay when the page allows it, otherwise the popup window. Failure to inject (restricted
// page, no access, page CSS beat the overlay, anything) NEVER makes search unavailable: the window opens instead. Pure (Chrome injected).
import type { OverlayReply } from '../overlay/protocol';

export interface OpenSearchDeps {
  /** scripting.executeScript({files:['overlay-host.js']}); throws on restricted pages / missing access */
  inject: (tabId: number) => Promise<void>;
  /** tabs.sendMessage to the injected host; throws when nobody answers */
  send: (tabId: number, cmd: 'toggle' | 'close') => Promise<OverlayReply | undefined>;
  openWindow: () => Promise<void>;
}

export interface OpenSearchTab {
  id?: number | undefined;
  url?: string | undefined;
}

/** Pages the overlay can never work on; skip the attempt (everything else is attempted and falls back on failure). */
const overlayImpossible = (url: string | undefined): boolean => url !== undefined && !/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url);

export async function openSearch(tab: OpenSearchTab | undefined, deps: OpenSearchDeps): Promise<'overlay' | 'window'> {
  const tabId = tab?.id;
  if (tabId !== undefined && !overlayImpossible(tab?.url)) {
    try {
      await deps.inject(tabId);
      const reply = await deps.send(tabId, 'toggle');
      if (reply?.ok) return 'overlay';
    } catch {
      /* fall through to the window */
    }
  }
  await deps.openWindow();
  return 'window';
}

export async function closeOverlay(tabId: number | undefined, deps: Pick<OpenSearchDeps, 'send'>): Promise<void> {
  if (tabId === undefined) return;
  try {
    await deps.send(tabId, 'close');
  } catch {
    /* the page navigated away: nothing to close */
  }
}
