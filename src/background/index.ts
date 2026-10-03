// Service worker wiring. ALL listeners are registered synchronously at top level (MV3 requirement); no module-level state
// is relied on across wake-ups. Owns routing and the offscreen lifecycle only — never the index (ARCHITECTURE §2.1).
import { createEngineClient } from './engine-client';
import { createChromeOffscreenApi, createOffscreenManager } from './offscreen-manager';
import { acceptMessage, routeMessage } from './router';

const SEARCH_WINDOW = { type: 'popup', width: 680, height: 520 } as const;

export function registerBackground(): void {
  const offscreen = createOffscreenManager(createChromeOffscreenApi());
  const engine = createEngineClient({ offscreen, sendMessage: (message) => chrome.runtime.sendMessage(message) });
  const openSearch = async () => {
    await chrome.windows.create({ ...SEARCH_WINDOW, url: chrome.runtime.getURL('/search.html') });
  };

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
  });
  chrome.action.onClicked.addListener(() => void openSearch());
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-search') void openSearch();
  });
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const message = acceptMessage(raw, sender, chrome.runtime.id);
    if (!message) return false; // not ours / not trusted: never answer, never hold a channel open
    void routeMessage(message, { ensureEngine: () => engine.ping(), openSearch }).then(sendResponse);
    return true; // async response; the SW stays alive while it is pending
  });
}
