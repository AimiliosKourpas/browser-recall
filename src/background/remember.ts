// "Remember this page" and "Save selection to memory" (M5). Explicit user actions only: they run on activeTab (granted by the
// context-menu click / keyboard command) and need no host permission. Everything is stored through the existing engine API
// (savePage / addSnippet): Saved items never expire and survive history deletion (ADR-012). Pure: Chrome is injected.
import { buildTextFragment } from '../capture/text-fragment';
import type { ExtractResult } from '../capture/extractor';
import type { EngineCaller } from './pipeline/maintenance';

export interface TabLike {
  id?: number | undefined;
  url?: string | undefined;
  title?: string | undefined;
}

export interface RememberDeps {
  engine: EngineCaller;
  /** runs the extractor in the tab; throws when the page cannot be scripted (chrome://, Web Store, no access) */
  extract: (tabId: number) => Promise<ExtractResult>;
  /** current selection of the tab (used by the keyboard command; the context menu passes it directly) */
  readSelection: (tabId: number) => Promise<string>;
  /** tab-scoped feedback badge: it clears itself when the tab navigates */
  badge: (tabId: number, kind: 'saved' | 'failed') => void;
  now: () => number;
}

export type RememberOutcome = { ok: true; mode: 'full' | 'title-only' } | { ok: false; reason: 'restricted' | 'no-tab' | 'engine' };

const isHttp = (url: string | undefined): url is string => typeof url === 'string' && /^https?:\/\//i.test(url);

export async function rememberTab(tab: TabLike, deps: RememberDeps): Promise<RememberOutcome> {
  if (tab.id === undefined) return { ok: false, reason: 'no-tab' };
  const tabId = tab.id;
  if (!isHttp(tab.url)) {
    deps.badge(tabId, 'failed'); // chrome://, the new-tab page, extension pages…: nothing can or should be stored
    return { ok: false, reason: 'restricted' };
  }
  let extracted: ExtractResult | undefined;
  try {
    extracted = await deps.extract(tabId);
  } catch {
    extracted = undefined; // restricted page that still has an http(s) URL (e.g. the Web Store) or no access: title + URL only
  }
  try {
    const page = extracted?.ok ? extracted : undefined;
    await deps.engine.call({
      method: 'savePage',
      params: {
        url: tab.url,
        title: page?.title || tab.title || '',
        ...(page ? { description: page.description, headings: page.headings, body: page.text, ...(page.lang ? { lang: page.lang } : {}) } : {}),
        savedAt: deps.now(),
      },
    });
    deps.badge(tabId, 'saved');
    return { ok: true, mode: page ? 'full' : 'title-only' };
  } catch {
    deps.badge(tabId, 'failed');
    return { ok: false, reason: 'engine' };
  }
}

export async function saveSelection(tab: TabLike, selectionText: string | undefined, deps: RememberDeps): Promise<RememberOutcome> {
  if (tab.id === undefined) return { ok: false, reason: 'no-tab' };
  const tabId = tab.id;
  if (!isHttp(tab.url)) {
    deps.badge(tabId, 'failed');
    return { ok: false, reason: 'restricted' };
  }
  let text = selectionText?.trim();
  if (!text) {
    try {
      text = (await deps.readSelection(tabId)).trim();
    } catch {
      text = '';
    }
  }
  const fragment = text ? buildTextFragment(text) : undefined;
  if (!text || !fragment) {
    deps.badge(tabId, 'failed');
    return { ok: false, reason: 'restricted' };
  }
  try {
    await deps.engine.call({ method: 'addSnippet', params: { url: tab.url, pageTitle: tab.title ?? '', text, fragment, createdAt: deps.now() } });
    deps.badge(tabId, 'saved');
    return { ok: true, mode: 'full' };
  } catch {
    deps.badge(tabId, 'failed');
    return { ok: false, reason: 'engine' };
  }
}
