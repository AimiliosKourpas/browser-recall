// Injected into the page's isolated world on shortcut/click. Holds a CLOSED shadow root containing one iframe to search.html.
declare global {
  interface Window {
    __brOverlay?: { toggle(): void; close(): void };
  }
}
(() => {
  if (window.__brOverlay) return;
  let host: HTMLElement | undefined;
  let prevFocus: Element | null = null;
  // spike toggle: set by the test via a data attribute on <html> before injection (never read by production code)
  const inertMode = document.documentElement.getAttribute('data-br-inert') === '1';

  const close = () => {
    if (inertMode) document.body.inert = false;
    host?.remove();
    host = undefined;
    const p = prevFocus as HTMLElement | null;
    prevFocus = null;
    if (p && typeof p.focus === 'function') p.focus({ preventScroll: true });
  };
  const open = () => {
    prevFocus = document.activeElement;
    host = document.createElement('div');
    host.setAttribute('popover', 'manual'); // top layer: stays above fullscreen elements and any page z-index
    host.style.cssText = 'all:initial;position:fixed;inset:0;border:0;padding:0;margin:0;background:transparent;width:100vw;height:100vh;overflow:visible;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('search.html?overlay=1');
    iframe.setAttribute('title', 'Search');
    iframe.style.cssText = 'position:fixed;top:10vh;left:50%;transform:translateX(-50%);width:min(640px,92vw);height:420px;border:0;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.4);background:#fff;color-scheme:normal;';
    shadow.append(iframe);
    document.documentElement.append(host);
    try {
      (host as HTMLElement & { showPopover(): void }).showPopover();
    } catch {
      /* popover unsupported: fall back to plain fixed positioning */
    }
    if (inertMode) document.body.inert = true;
    iframe.addEventListener('load', () => iframe.focus());
  };
  window.__brOverlay = { toggle: () => (host ? close() : open()), close };
  chrome.runtime.onMessage.addListener((m, _s, sendResponse) => {
    if (m?.cmd === 'overlay-toggle') window.__brOverlay?.toggle();
    if (m?.cmd === 'overlay-close') window.__brOverlay?.close();
    if (m?.cmd === 'overlay-info') {
      let popoverOpen = false;
      try {
        popoverOpen = !!host?.matches(':popover-open');
      } catch {
        /* unsupported */
      }
      sendResponse({ open: !!host, popoverOpen, fullscreen: !!document.fullscreenElement });
    }
    return false;
  });
})();
export {};
