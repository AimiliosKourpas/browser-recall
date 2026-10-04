// Injected on demand by the service worker (scripting.executeScript, files: ['overlay-host.js']). Not declared as a content script.
import { createOverlay } from '../overlay/host';
import { isOverlayCommand } from '../overlay/protocol';

export default defineUnlistedScript(() => {
  const w = window as Window & { __brOverlay?: ReturnType<typeof createOverlay> };
  w.__brOverlay ??= createOverlay({ doc: document, searchUrl: chrome.runtime.getURL('/search.html') });
  const overlay = w.__brOverlay;
  // idempotent: a second injection reuses the first instance, and only one listener is ever registered per instance
  const flag = '__brOverlayListener';
  if ((w as unknown as Record<string, unknown>)[flag]) return;
  (w as unknown as Record<string, unknown>)[flag] = true;
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !isOverlayCommand(raw)) return false; // only our service worker
    if (raw.cmd === 'close') {
      overlay.close();
      sendResponse({ ok: true, open: false });
    } else sendResponse(overlay.toggle());
    return false;
  });
  pageshowCleanup(overlay);
});

/** bfcache/navigation teardown: never leave a page inert */
function pageshowCleanup(overlay: ReturnType<typeof createOverlay>): void {
  window.addEventListener('pagehide', () => overlay.close());
}
