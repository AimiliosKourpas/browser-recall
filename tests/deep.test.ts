import { describe, expect, it } from 'vitest';
import type { ExtractResult } from '../src/capture/extractor';
import { captureTab, isEligibleUrl, sha256Hex, type CaptureDeps } from '../src/background/deep/capture';
import { createDeepController } from '../src/background/deep/controller';
import { createStateStore, defaultState, hasValidConsent, stateSchema, STATE_KEY, type PipelineState } from '../src/background/pipeline/state';
import type { EngineCall, EngineResults } from '../src/engine/contract';
import { handleCall } from '../src/engine/handlers';
import { NOW, newStore } from './helpers/engine';

const body = 'Quince jelly is made by simmering fruit slowly. '.repeat(10);
const page = (over: Partial<Extract<ExtractResult, { ok: true }>> = {}): ExtractResult => ({ ok: true, title: 'Quince', description: '', headings: 'Jelly', text: body, lang: 'en', truncated: false, ...over });

async function setup(opts: { deep?: Partial<PipelineState['deep']>; consent?: boolean; access?: boolean; extract?: CaptureDeps['extract'] } = {}) {
  const { store } = await newStore();
  const state: PipelineState = { ...defaultState(), consent: opts.consent === false ? null : { version: 1, at: NOW }, deep: { enabled: true, enabledAt: NOW, excluded: [], ...opts.deep } };
  const engine = { call: async <C extends EngineCall>(c: C) => handleCall(c, { info: { protocol: 1, instanceId: 't' }, getStore: async () => store }) as Promise<EngineResults[C['method']]> };
  const calls = { extract: 0 };
  const deps: CaptureDeps = {
    engine,
    readState: async () => state,
    hasAccess: async () => opts.access !== false,
    extract: opts.extract ?? (async () => (calls.extract++, page())),
    hash: sha256Hex,
    now: () => NOW,
  };
  return { store, deps, calls, state };
}
const tab = { id: 1, url: 'https://recipes.example.com/quince', title: 'tab' };
const find = (store: Awaited<ReturnType<typeof setup>>['store'], q: string) => store.search({ query: q, now: NOW }).results;

describe('Deep Search capture gates', () => {
  it('captures an eligible page and makes its body text searchable as source "deep"', async () => {
    const { store, deps } = await setup();
    expect(await captureTab(tab, deps)).toEqual({ captured: true, changed: true });
    const r = find(store, 'simmering');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ url: tab.url, source: 'deep', flags: { history: false, content: true, saved: false } });
  });
  it.each([
    ['disabled', { deep: { enabled: false } }, tab],
    ['no-consent', { consent: false }, tab],
    ['no-permission', { access: false }, tab],
    ['excluded', { deep: { excluded: ['example.com'] } }, tab],
    ['incognito', {}, { ...tab, incognito: true }],
    ['ineligible', {}, { ...tab, url: 'chrome://settings' }],
  ])('does nothing and never reads the page when %s', async (reason, opts, t) => {
    const { store, deps, calls } = await setup(opts);
    expect(await captureTab(t, deps)).toEqual({ captured: false, reason });
    expect(calls.extract).toBe(0);
    expect(store.stats().pages).toBe(0);
  });
  it('stores nothing when the extractor skips the page (password / payment / too little text) or fails', async () => {
    for (const result of [{ ok: false, reason: 'password-field' }, { ok: false, reason: 'too-little-text' }] as ExtractResult[]) {
      const { store, deps } = await setup({ extract: async () => result });
      expect(await captureTab(tab, deps)).toEqual({ captured: false, reason: 'skipped-page' });
      expect(store.stats().pages).toBe(0);
    }
    const failing = await setup({ extract: async () => { throw new Error('tab closed'); } });
    expect(await captureTab(tab, failing.deps)).toEqual({ captured: false, reason: 'extract-failed' });
  });
  it('duplicate visits do not rewrite; a changed page replaces the text; the page row stays single', async () => {
    let text = body;
    const { store, deps } = await setup({ extract: async () => page({ text }) });
    expect(await captureTab(tab, deps)).toEqual({ captured: true, changed: true });
    expect(await captureTab(tab, deps)).toEqual({ captured: true, changed: false });
    text = 'Medlar wine ferments for months in a cool cellar. '.repeat(8);
    expect(await captureTab(tab, deps)).toEqual({ captured: true, changed: true });
    expect(find(store, 'simmering')).toEqual([]);
    expect(find(store, 'medlar')).toHaveLength(1);
    expect(store.stats().pages).toBe(1);
  });
  it('enforces content limits: an oversized page is stored capped, not rejected', async () => {
    const { store, deps } = await setup({ extract: async () => page({ text: 'zebra '.repeat(1) + 'filler words here '.repeat(20_000) }) });
    expect((await captureTab(tab, deps)).captured).toBe(true);
    expect(store.stats().textBytes).toBeLessThanOrEqual(60_000);
  });
  it('keeps History data when a page already in history gets Deep text, and Chrome deletion removes it', async () => {
    const { store, deps } = await setup();
    store.upsertHistory([{ url: tab.url, title: 'From history', lastVisitTime: NOW - 1000, visitCount: 3 }]);
    await captureTab(tab, deps);
    expect(find(store, 'simmering')[0]?.flags).toEqual({ history: true, content: true, saved: false });
    store.deleteUrls([tab.url]);
    expect(find(store, 'simmering')).toEqual([]);
  });
});

describe('eligible URLs', () => {
  it.each([
    ['https://news.example.org/a?b=1', true],
    ['http://example.com/', true],
    ['https://user:pw@example.com/', false],
    ['http://localhost:3000/', false],
    ['http://127.0.0.1/', false],
    ['http://192.168.1.2/admin', false],
    ['http://[::1]/', false],
    ['https://intranet/wiki', false],
    ['https://printer.local/', false],
    ['file:///etc/passwd', false],
    ['chrome-extension://abc/page.html', false],
    ['not a url', false],
    [undefined, false],
  ])('%s → %s', (url, ok) => expect(isEligibleUrl(url)).toBe(ok));
});

describe('Deep Search controller', () => {
  async function controller(permission: boolean, consent = true) {
    const { store } = await newStore();
    const memory: Record<string, unknown> = { [STATE_KEY]: { ...defaultState(), consent: consent ? { version: 1, at: NOW } : null } };
    const state = createStateStore({ get: async () => memory, set: async (items) => void Object.assign(memory, items) });
    let granted = permission;
    const engine = { call: async <C extends EngineCall>(c: C) => handleCall(c, { info: { protocol: 1, instanceId: 't' }, getStore: async () => store }) as Promise<EngineResults[C['method']]> };
    const ctl = createDeepController({ state, engine, hasPermission: async () => granted, now: () => NOW });
    return { ctl, state, store, revoke: () => (granted = false) };
  }
  it('defaults to off and the stored state parses without a deep section (older installs)', async () => {
    expect(defaultState().deep.enabled).toBe(false);
    const older: Record<string, unknown> = { ...defaultState() };
    delete older.deep;
    expect(stateSchema.parse(older).deep).toEqual({ enabled: false, enabledAt: null, excluded: [] });
    expect(hasValidConsent(defaultState())).toBe(false);
  });
  it('refuses to enable without the permission or without consent; denial leaves everything off', async () => {
    await expect((await controller(false)).ctl.enable()).rejects.toThrow('permission-required');
    await expect((await controller(true, false)).ctl.enable()).rejects.toThrow('consent-required');
    expect(await (await controller(false)).ctl.status()).toMatchObject({ enabled: false, permission: false });
  });
  it('enables with the permission, and reconcile turns it off when the permission disappears — data stays intact', async () => {
    const { ctl, state, store, revoke } = await controller(true);
    store.upsertContent({ url: 'https://a.example.com/x', title: 'x', body: 'kumquat marmalade', indexedAt: NOW });
    expect((await ctl.enable()).enabled).toBe(true);
    revoke();
    expect((await ctl.status()).enabled).toBe(false); // reported off immediately
    await ctl.reconcile();
    expect((await state.read()).deep.enabled).toBe(false);
    expect(store.search({ query: 'kumquat', now: NOW }).results).toHaveLength(1); // nothing was deleted
    expect(store.integrityCheck().ok).toBe(true);
  });
  it('exclude removes that site’s Deep text only; clear removes all Deep text but keeps History and Saved', async () => {
    const { ctl, store } = await controller(true);
    store.upsertContent({ url: 'https://a.example.com/x', title: 'x', body: 'kumquat one', indexedAt: NOW });
    store.upsertContent({ url: 'https://b.example.org/y', title: 'y', body: 'kumquat two', indexedAt: NOW });
    store.upsertHistory([{ url: 'https://c.example.net/z', title: 'z', lastVisitTime: NOW - 10, visitCount: 1 }]);
    store.upsertContent({ url: 'https://c.example.net/z', title: 'z', body: 'kumquat three', indexedAt: NOW });
    store.savePage({ url: 'https://d.example.io/s', title: 's', body: 'kumquat four', savedAt: NOW });
    await ctl.exclude('https://www.a.example.com/some/path');
    expect(store.search({ query: 'kumquat', now: NOW }).results.map((r) => r.url).sort()).toEqual(['https://b.example.org/y', 'https://c.example.net/z', 'https://d.example.io/s']);
    expect((await ctl.status()).excluded).toEqual(['a.example.com']);
    expect(await ctl.clear()).toEqual({ deletedPages: 1, demotedPages: 1 });
    const left = store.search({ query: 'kumquat', now: NOW }).results.map((r) => r.url);
    expect(left).toEqual(['https://d.example.io/s']);
    expect(store.search({ query: 'z', now: NOW }).results.some((r) => r.url === 'https://c.example.net/z')).toBe(true); // history row remains
    await expect(ctl.exclude('not a domain')).rejects.toThrow('bad-domain');
    expect((await ctl.include('a.example.com')).excluded).toEqual([]);
  });
});
