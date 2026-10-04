// Deep Search capture (M6, ADR-014). Opt-in: runs only when the user enabled it AND consent is valid AND the optional host
// permission is actually held for the page's origin. Pure (Chrome injected), so every gate is unit-tested.
import type { ExtractResult } from '../../capture/extractor';
import type { EngineCaller } from '../pipeline/maintenance';
import { hasValidConsent, type PipelineState } from '../pipeline/state';

export const MIN_TEXT_LENGTH = 200;

export interface CaptureTab {
  id?: number | undefined;
  url?: string | undefined;
  title?: string | undefined;
  incognito?: boolean | undefined;
  status?: string | undefined;
}

export interface CaptureDeps {
  engine: EngineCaller;
  readState: () => Promise<PipelineState>;
  /** chrome.permissions.contains for this exact URL's origin */
  hasAccess: (url: string) => Promise<boolean>;
  extract: (tabId: number) => Promise<ExtractResult>;
  /** SHA-256 hex of the text, used for duplicate detection */
  hash: (text: string) => Promise<string>;
  now: () => number;
}

export type CaptureOutcome =
  | { captured: true; changed: boolean }
  | { captured: false; reason: 'disabled' | 'paused' | 'no-consent' | 'no-permission' | 'ineligible' | 'excluded' | 'incognito' | 'skipped-page' | 'extract-failed' | 'engine' };

const PRIVATE_HOST = /^(localhost|.*\.(local|localdomain|internal|lan|home|corp))$/i;

/** Public http(s) pages only: no credentials in the URL, no IP literals, no single-label/intranet-style hosts. */
export function isEligibleUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv6 / IPv4 literal
  if (!host.includes('.') || PRIVATE_HOST.test(host)) return false;
  return true;
}

export const normalizeDomain = (input: string): string => input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

export const isExcluded = (url: string, excluded: string[]): boolean => {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return excluded.some((d) => host === d || host.endsWith(`.${d}`));
};

export async function captureTab(tab: CaptureTab, deps: CaptureDeps): Promise<CaptureOutcome> {
  const state = await deps.readState();
  if (!state.deep.enabled) return { captured: false, reason: 'disabled' };
  if (!hasValidConsent(state)) return { captured: false, reason: 'no-consent' };
  if (state.settings.paused) return { captured: false, reason: 'paused' };
  if (tab.id === undefined || !isEligibleUrl(tab.url)) return { captured: false, reason: 'ineligible' };
  if (tab.incognito) return { captured: false, reason: 'incognito' };
  if (isExcluded(tab.url, state.deep.excluded)) return { captured: false, reason: 'excluded' };
  if (!(await deps.hasAccess(tab.url))) return { captured: false, reason: 'no-permission' };
  let page: ExtractResult;
  try {
    page = await deps.extract(tab.id);
  } catch {
    return { captured: false, reason: 'extract-failed' }; // navigated away, discarded tab, no access…
  }
  if (!page.ok) return { captured: false, reason: 'skipped-page' };
  try {
    const result = await deps.engine.call({
      method: 'upsertContent',
      params: { url: tab.url, title: page.title || tab.title || '', headings: page.headings, description: page.description, body: page.text, ...(page.lang ? { lang: page.lang } : {}), contentHash: await deps.hash(`${page.title}\n${page.headings}\n${page.description}\n${page.text}`), indexedAt: deps.now() },
    });
    return result.skipped ? { captured: false, reason: 'ineligible' } : { captured: true, changed: result.changed };
  } catch {
    return { captured: false, reason: 'engine' };
  }
}

export const sha256Hex = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, '0')).join('');
