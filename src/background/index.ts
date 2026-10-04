// Service worker wiring. ALL listeners are registered synchronously at top level (MV3 requirement); no module-level state
// is relied on across wake-ups. Owns routing and the offscreen lifecycle only — never the index (ARCHITECTURE §2.1).
import { createEngineClient } from './engine-client';
import { createChromeOffscreenApi, createOffscreenManager } from './offscreen-manager';
import { createChromeAlarmsApi } from './pipeline/alarms';
import { createPipeline } from './pipeline/controller';
import { createStateStore } from './pipeline/state';
import { extractPage } from '../capture/extractor';
import { rememberTab, saveSelection, type RememberDeps, type TabLike } from './remember';
import { captureTab, MIN_TEXT_LENGTH, sha256Hex } from './deep/capture';
import { createDeepController, DEEP_ORIGINS } from './deep/controller';
import { acceptMessage, routeMessage } from './router';

const SEARCH_WINDOW = { type: 'popup', width: 680, height: 520 } as const;

export function registerBackground(): void {
  const offscreen = createOffscreenManager(createChromeOffscreenApi());
  const engine = createEngineClient({ offscreen, sendMessage: (message) => chrome.runtime.sendMessage(message) });
  const stateStore = createStateStore(chrome.storage.local);
  const pipeline = createPipeline({
    history: { search: (query) => chrome.history.search(query) },
    engine,
    state: stateStore,
    alarms: createChromeAlarmsApi(),
    now: () => Date.now(),
  });
  const deep = createDeepController({ state: stateStore, engine, // The e2e build (only) holds a required host permission instead of the optional one; the production manifest has no host_permissions.
    hasPermission: () => chrome.permissions.contains({ origins: chrome.runtime.getManifest().host_permissions ?? [...DEEP_ORIGINS] }), now: () => Date.now() });
  const captureDeps = {
    engine,
    readState: () => stateStore.read(),
    hasAccess: (url: string) => chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }),
    extract: async (tabId: number) => {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPage, args: [{ deep: true, minTextLength: MIN_TEXT_LENGTH }] });
      if (!injection?.result) throw new Error('no result');
      return injection.result;
    },
    hash: sha256Hex,
    now: () => Date.now(),
  };
  const rememberDeps: RememberDeps = {
    engine,
    extract: async (tabId) => {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPage, args: [{ deep: false, minTextLength: 0 }] });
      if (!injection?.result) throw new Error('no result');
      return injection.result;
    },
    readSelection: async (tabId) => {
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: () => String(getSelection() ?? '') });
      return injection?.result ?? '';
    },
    badge: (tabId, kind) => {
      void chrome.action.setBadgeBackgroundColor({ tabId, color: kind === 'saved' ? '#1a7f37' : '#b42318' });
      void chrome.action.setBadgeText({ tabId, text: kind === 'saved' ? '✓' : '!' }); // tab-scoped: clears when the tab navigates
    },
    now: () => Date.now(),
  };
  const remember = async (tab: TabLike | undefined, selectionText: string | undefined, snippet: boolean) => (snippet ? saveSelection(tab ?? {}, selectionText, rememberDeps) : rememberTab(tab ?? {}, rememberDeps));
  const activeTab = async (): Promise<TabLike | undefined> => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const openSearch = async () => {
    await chrome.windows.create({ ...SEARCH_WINDOW, url: chrome.runtime.getURL('/search.html') });
  };

  chrome.runtime.onInstalled.addListener((details) => {
    // Nothing is read before consent: install/update only opens the consent page, and only when consent is missing or outdated
    // (so a reload of the unpacked extension, or an update that keeps the consent version, never asks again).
    // context menus persist across restarts but must be (re)created on install/update; removeAll keeps this idempotent
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'br-remember', title: chrome.i18n.getMessage('menuRemember'), contexts: ['page'] });
      chrome.contextMenus.create({ id: 'br-snippet', title: chrome.i18n.getMessage('menuSnippet'), contexts: ['selection'] });
    });
    if (details.reason !== 'install' && details.reason !== 'update') return;
    void pipeline.needsConsent().then((needs) => {
      if (needs) void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') });
    });
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'br-remember') void remember(tab, undefined, false);
    else if (info.menuItemId === 'br-snippet') void remember(tab, info.selectionText, true);
  });
  chrome.runtime.onStartup.addListener(() => void pipeline.onWake());
  // Deep Search: a finished page load in an ordinary tab. Every gate (opt-in, consent, permission, eligibility, exclusions) is inside captureTab.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') void captureTab({ ...tab, id: tabId }, captureDeps);
  });
  chrome.permissions.onRemoved.addListener(() => void deep.reconcile());
  void deep.reconcile();
  chrome.alarms.onAlarm.addListener((alarm) => void pipeline.onAlarm(alarm.name));
  chrome.history.onVisited.addListener((item) => void pipeline.onVisited(item));
  chrome.history.onVisitRemoved.addListener((removed) => void pipeline.onVisitRemoved({ allHistory: removed.allHistory, urls: removed.urls ?? [] }));
  void pipeline.onWake(); // every wake of the service worker: restore schedules, resume an unfinished import (no-op without consent)
  chrome.action.onClicked.addListener(() => void openSearch());
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-search') void openSearch();
    else if (command === 'remember-page') void activeTab().then((tab) => remember(tab, undefined, false));
  });
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const message = acceptMessage(raw, sender, chrome.runtime.id);
    if (!message) return false; // not ours / not trusted: never answer, never hold a channel open
    void routeMessage(message, { ensureEngine: () => engine.ping(), engineCall: (call) => engine.call(call), pipeline, openSearch, deep,
      remember: async (tabId, snippet) => {
        const tab = tabId === undefined ? await activeTab() : await chrome.tabs.get(tabId);
        return remember(tab, undefined, snippet);
      },
    }).then(sendResponse);
    return true; // async response; the SW stays alive while it is pending
  });
}
