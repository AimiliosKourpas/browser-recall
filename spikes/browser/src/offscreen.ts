// Offscreen document (reason: WORKERS): hosts the engine worker and relays runtime messages / Ports to it.
const worker = new Worker('engine-worker.js', { type: 'module' });
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void }>();
let readyResolve: () => void;
const ready = new Promise<void>((r) => (readyResolve = r));
worker.onmessage = (e: MessageEvent) => {
  if (e.data.ready) return readyResolve();
  pending.get(e.data.id)?.resolve(e.data);
  pending.delete(e.data.id);
};
worker.onerror = (e) => console.error('engine worker error', e.message);

async function call(cmd: string, args: unknown): Promise<unknown> {
  await ready;
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    worker.postMessage({ id, cmd, args });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'engine') return false;
  call(msg.cmd, msg.args).then(sendResponse);
  return true;
});

// UI pages talk to the engine over a named Port (does not keep the service worker alive).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'engine') return;
  port.onMessage.addListener(async (m: { rid: number; cmd: string; args: unknown }) => {
    const r = (await call(m.cmd, m.args)) as Record<string, unknown>;
    port.postMessage({ rid: m.rid, ...r });
  });
});
document.title = 'engine-host';
