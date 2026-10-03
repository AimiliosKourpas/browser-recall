// Spike search UI: input + results over a named Port to the engine. DOM text nodes only (no innerHTML).
const input = document.getElementById('q') as HTMLInputElement;
const list = document.getElementById('results') as HTMLUListElement;
const statusEl = document.getElementById('status') as HTMLElement;
let port: chrome.runtime.Port | undefined;
let rid = 0;
let composing = false;
const connect = () => {
  port = chrome.runtime.connect({ name: 'engine' });
  port.onDisconnect.addListener(() => (port = undefined));
  port.onMessage.addListener((m: { rid: number; ok: boolean; result?: { ms: number; hits: number; top: { id: number }[] } }) => {
    if (m.rid !== rid) return; // stale response discarded
    list.replaceChildren();
    for (const h of m.result?.top ?? []) {
      const li = document.createElement('li');
      li.textContent = `page ${h.id}`;
      list.append(li);
    }
    statusEl.textContent = `${m.result?.hits ?? 0} hits in ${m.result?.ms ?? '?'} ms`;
  });
};
connect();
input.addEventListener('compositionstart', () => (composing = true));
input.addEventListener('compositionend', () => (composing = false));
input.addEventListener('input', () => {
  if (!port) connect();
  port!.postMessage({ rid: ++rid, cmd: 'query', args: { q: input.value } });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') void chrome.runtime.sendMessage({ target: 'sw', cmd: 'overlay-close' });
  if (e.key === 'Enter' && (composing || e.isComposing)) e.preventDefault();
});
// The host focuses the <iframe>; the framed document then receives window focus and must hand it to the input.
window.addEventListener('focus', () => input.focus());
input.focus();
(window as unknown as { __ready: boolean }).__ready = true;
