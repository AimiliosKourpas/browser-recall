// Service worker wiring. ALL listeners are registered synchronously at top level (MV3 requirement); no module-level state
// is relied on across wake-ups. Owns routing and the offscreen lifecycle only — never the index (ARCHITECTURE §2.1).
import { createEngineClient } from './engine-client';
import { createChromeOffscreenApi, createOffscreenManager } from './offscreen-manager';
import { createChromeAlarmsApi } from './pipeline/alarms';
import { createPipeline } from './pipeline/controller';
import { createStateStore } from './pipeline/state';
import { acceptMessage, routeMessage } from './router';

const SEARCH_WINDOW = { type: 'popup', width: 680, height: 520 } as const;

export function registerBackground(): void {
  const offscreen = createOffscreenManager(createChromeOffscreenApi());
  const engine = createEngineClient({ offscreen, sendMessage: (message) => chrome.runtime.sendMessage(message) });
  const pipeline = createPipeline({
    history: { search: (query) => chrome.history.search(query) },
    engine,
    state: createStateStore(chrome.storage.local),
    alarms: createChromeAlarmsApi(),
    now: () => Date.now(),
  });
  const openSearch = async () => {
    await chrome.windows.create({ ...SEARCH_WINDOW, url: chrome.runtime.getURL('/search.html') });
  };

  chrome.runtime.onInstalled.addListener((details) => {
    // Nothing is read before consent: install/update only opens the consent page, and only when consent is missing or outdated
    // (so a reload of the unpacked extension, or an update that keeps the consent version, never asks again).
    if (details.reason !== 'install' && details.reason !== 'update') return;
    void pipeline.needsConsent().then((needs) => {
      if (needs) void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    });
  });
  chrome.runtime.onStartup.addListener(() => void pipeline.onWake());
  chrome.alarms.onAlarm.addListener((alarm) => void pipeline.onAlarm(alarm.name));
  chrome.history.onVisited.addListener((item) => void pipeline.onVisited(item));
  chrome.history.onVisitRemoved.addListener((removed) => void pipeline.onVisitRemoved({ allHistory: removed.allHistory, urls: removed.urls ?? [] }));
  void pipeline.onWake(); // every wake of the service worker: restore schedules, resume an unfinished import (no-op without consent)
  chrome.action.onClicked.addListener(() => void openSearch());
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-search') void openSearch();
  });
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const message = acceptMessage(raw, sender, chrome.runtime.id);
    if (!message) return false; // not ours / not trusted: never answer, never hold a channel open
    void routeMessage(message, { ensureEngine: () => engine.ping(), engineCall: (call) => engine.call(call), pipeline, openSearch }).then(sendResponse);
    return true; // async response; the SW stays alive while it is pending
  });
}
