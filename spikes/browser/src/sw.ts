// Stateless router (ARCHITECTURE §2). All listeners registered synchronously at top level; no durable globals.
const OFFSCREEN = 'offscreen.html';
let creating: Promise<void> | undefined; // only a de-dupe lock; losing it on SW termination is harmless

async function hasOffscreen(): Promise<boolean> {
  const ctx = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return ctx.length > 0;
}
async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({ url: OFFSCREEN, reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Host SQLite WASM worker' })
      .finally(() => (creating = undefined));
  }
  await creating;
}

async function logEvent(kind: string, data: unknown) {
  await chrome.storage.local.set({ [`ev:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`]: { kind, data, t: Date.now() } });
}

// ---- history event logging (deletion/expiry spike) ----
chrome.history.onVisitRemoved.addListener((r) => void logEvent('removed', r));
chrome.history.onVisited.addListener((r) => void logEvent('visited', { url: r.url }));

// ---- overlay + fallback (overlay spike) ----
async function openSearch(tabId: number | undefined): Promise<'overlay' | 'window'> {
  if (tabId !== undefined) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['overlay-host.js'] });
      await chrome.tabs.sendMessage(tabId, { cmd: 'overlay-toggle' });
      return 'overlay';
    } catch (e) {
      await logEvent('overlay-failed', String(e));
    }
  }
  await chrome.windows.create({ url: chrome.runtime.getURL('search.html'), type: 'popup', width: 640, height: 480 });
  return 'window';
}
chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd === 'open-search') await openSearch(tab?.id);
});
chrome.action.onClicked.addListener((tab) => void openSearch(tab.id));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'sw') return false;
  (async () => {
    switch (msg.cmd) {
      case 'ping':
        return { ok: true, t: Date.now() };
      case 'engine': {
        await ensureOffscreen();
        return chrome.runtime.sendMessage({ target: 'engine', cmd: msg.engineCmd, args: msg.args });
      }
      case 'offscreen-close':
        if (await hasOffscreen()) await chrome.offscreen.closeDocument();
        return { closed: true };
      case 'offscreen-ensure':
        await ensureOffscreen();
        return { ok: true };
      case 'offscreen-exists':
        return { exists: await hasOffscreen() };
      case 'open-search':
        return { surface: await openSearch(msg.tabId) };
      case 'overlay-close':
        // from the overlay iframe: sender.tab identifies the host tab
        if (sender.tab?.id !== undefined) await chrome.tabs.sendMessage(sender.tab.id, { cmd: 'overlay-close' });
        return { ok: true };
      case 'netprobe':
        try {
          await fetch(msg.url, { mode: 'no-cors' });
          return { result: 'sent' };
        } catch (e) {
          return { result: `blocked: ${(e as Error).message}` };
        }
      case 'commands':
        return chrome.commands.getAll();
      case 'events': {
        const all = await chrome.storage.local.get(null);
        return Object.entries(all).filter(([k]) => k.startsWith('ev:')).sort().map(([, v]) => v);
      }
      case 'clear-events': {
        const all = await chrome.storage.local.get(null);
        await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('ev:')));
        return { ok: true };
      }
      case 'history-add': {
        const urls = msg.urls as { url: string; visitTime?: number; title?: string }[];
        for (let i = 0; i < urls.length; i += 500) await Promise.all(urls.slice(i, i + 500).map((u) => chrome.history.addUrl(u)));
        return { added: urls.length };
      }
      case 'history-search':
        return chrome.history.search(msg.query);
      case 'history-delete-url':
        await chrome.history.deleteUrl({ url: msg.url });
        return { ok: true };
      case 'history-delete-range':
        await chrome.history.deleteRange({ startTime: msg.startTime, endTime: msg.endTime });
        return { ok: true };
      case 'history-delete-all':
        await chrome.history.deleteAll();
        return { ok: true };
      case 'browsing-data-clear':
        await chrome.browsingData.removeHistory({ since: msg.since ?? 0 });
        return { ok: true };
      case 'perm-contains':
        return { has: await chrome.permissions.contains(msg.perms) };
      default:
        return { error: `unknown ${msg.cmd}` };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e) }));
  return true;
});
