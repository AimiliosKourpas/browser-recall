// The in-page overlay (M7, ADR-003): one host element in the page's top layer (popover="manual") holding a CLOSED shadow root with a
// click-away backdrop and ONE iframe of the existing search page. Injected on demand by the service worker (activeTab / host access),
// never a content script. Every style that matters is an inline !important declaration so page CSS cannot hide or move it.
import { applyInert, restoreInert, type InertSnapshot } from './inert';
import { OVERLAY_FLAG, type OverlayReply } from './protocol';

const IMPORTANT = (el: HTMLElement, css: Record<string, string>) => {
  for (const [prop, value] of Object.entries(css)) el.style.setProperty(prop, value, 'important');
};

export interface OverlayEnv {
  doc: Document;
  /** full URL of the search page (chrome.runtime.getURL) */
  searchUrl: string;
}

export function createOverlay(env: OverlayEnv) {
  let host: HTMLElement | undefined;
  let inert: InertSnapshot | undefined;
  let previousFocus: Element | null = null;

  const isOpen = () => host !== undefined;

  const close = (): void => {
    const h = host;
    host = undefined;
    restoreInert(inert); // first: a focusable page must be focusable again before we hand focus back
    inert = undefined;
    try {
      h?.hidePopover?.();
    } catch {
      /* already hidden or unsupported */
    }
    h?.remove();
    const back = previousFocus as HTMLElement | null;
    previousFocus = null;
    if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  };

  const open = (): OverlayReply => {
    const { doc } = env;
    const body = doc.body;
    if (!body || !doc.documentElement) return { ok: false, reason: 'no-body' };
    try {
      previousFocus = doc.activeElement && doc.activeElement !== body ? doc.activeElement : null;
      const h = doc.createElement('div');
      h.setAttribute('popover', 'manual'); // top layer: above fullscreen elements and any page z-index
      IMPORTANT(h, { all: 'initial', position: 'fixed', inset: '0', width: '100vw', height: '100vh', margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible', display: 'block', visibility: 'visible', opacity: '1', 'pointer-events': 'auto' });
      const shadow = h.attachShadow({ mode: 'closed' });
      const backdrop = doc.createElement('div');
      IMPORTANT(backdrop, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)' });
      backdrop.addEventListener('mousedown', (e) => {
        e.preventDefault();
        close();
      });
      const frame = doc.createElement('iframe');
      frame.setAttribute('title', 'Browser Recall search');
      frame.setAttribute('allow', ''); // no camera, microphone, clipboard-read… for the framed UI
      frame.src = `${env.searchUrl}${env.searchUrl.includes('?') ? '&' : '?'}${OVERLAY_FLAG}`;
      IMPORTANT(frame, { position: 'fixed', top: '10vh', left: '50%', transform: 'translateX(-50%)', width: 'min(680px, 94vw)', height: 'min(560px, 80vh)', border: '0', 'border-radius': '12px', 'box-shadow': '0 8px 40px rgba(0,0,0,.45)', background: '#fff', 'color-scheme': 'normal', display: 'block', visibility: 'visible', opacity: '1' });
      shadow.append(backdrop, frame);
      h.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close(); // focus on the host itself (not in the frame)
      });
      doc.documentElement.append(h);
      host = h;
      inert = applyInert(body);
      try {
        (h as HTMLElement & { showPopover(): void }).showPopover();
      } catch {
        /* popover unsupported: the fixed positioning above still works */
      }
      const rect = h.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) throw new Error('overlay not rendered'); // page CSS beat us: let the caller fall back
      frame.addEventListener('load', () => frame.focus());
      frame.focus();
      return { ok: true, open: true };
    } catch (error) {
      close(); // never leave the page inert or the host attached after a failure
      return { ok: false, reason: error instanceof Error ? error.message : 'open-failed' };
    }
  };

  return {
    isOpen,
    open,
    close,
    toggle: (): OverlayReply => {
      if (isOpen()) {
        close();
        return { ok: true, open: false };
      }
      return open();
    },
  };
}
