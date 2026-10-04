import { describe, expect, it } from 'vitest';
import { ALARM_MAINTENANCE, ALARM_RECONCILE, ALARM_TITLE_REFRESH } from '../src/background/pipeline/alarms';
import { CONSENT_VERSION, defaultSettings, defaultState, settingsPatchSchema, settingsSchema, stateSchema } from '../src/background/pipeline/state';
import { acceptMessage } from '../src/background/router';
import { exportDataSchema } from '../src/engine/model';
import { DAY, NOW, newStore } from './helpers/engine';
import { harness, visit } from './helpers/pipeline';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const page = { id: ID, url: `chrome-extension://${ID}/settings.html` };
const urls = (h: Awaited<ReturnType<typeof harness>>, q: string) => h.store.search({ query: q, now: NOW }).results.map((r) => r.url);

describe('settings schema', () => {
  it('defaults are the product defaults, and older stored state without settings still parses', () => {
    expect(defaultSettings()).toEqual({ paused: false, retentionMonths: 12, capMb: 1000, mirrorDeletion: true });
    const older: Record<string, unknown> = { ...defaultState() };
    delete older.settings;
    expect(stateSchema.parse(older).settings).toEqual(defaultSettings());
  });
  it('validates patches: unknown keys, wrong types and out-of-range values are rejected', () => {
    expect(settingsPatchSchema.safeParse({ paused: true }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ retentionMonths: null, capMb: 500 }).success).toBe(true);
    for (const bad of [{ evil: 1 }, { paused: 'yes' }, { retentionMonths: 0 }, { retentionMonths: 1.5 }, { capMb: 1 }, { capMb: 10_000_000 }, { mirrorDeletion: 1 }]) expect(settingsPatchSchema.safeParse(bad).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
  it('the service worker accepts settings messages only from our pages and only with a valid patch', () => {
    expect(acceptMessage({ type: 'sw/settings-get' }, page, ID)).toEqual({ type: 'sw/settings-get' });
    expect(acceptMessage({ type: 'sw/settings-set', patch: { paused: true } }, page, ID)).toEqual({ type: 'sw/settings-set', patch: { paused: true } });
    expect(acceptMessage({ type: 'sw/settings-set', patch: { capMb: 1 } }, page, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/settings-set', patch: { paused: true } }, { id: ID, url: 'https://evil.example/' }, ID)).toBeUndefined();
  });
});

describe('pause / resume', () => {
  it('paused: live visits are not indexed and the reconcile alarm does nothing', async () => {
    const h = await harness([visit('https://before.example/', 'Before', 1)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.resumeImport();
    await h.pipeline.updateSettings({ paused: true });
    expect((await h.pipeline.status()).paused).toBe(true);
    await h.pipeline.onVisited({ url: 'https://during.example/', title: 'During', lastVisitTime: NOW, visitCount: 1 });
    expect(urls(h, 'during')).toEqual([]);
    h.calls.length = 0;
    await h.pipeline.onAlarm(ALARM_RECONCILE);
    expect(h.calls).toEqual([]); // paused: the reconcile alarm does nothing
    expect(urls(h, 'before')).toHaveLength(1);
  });
  it('resume reconciles the gap from Chrome history (visits made while paused appear)', async () => {
    const items = [visit('https://before.example/', 'Before', 1)];
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.resumeImport();
    await h.pipeline.updateSettings({ paused: true });
    items.push(visit('https://during.example/', 'During', 0, { lastVisitTime: NOW - 1000 })); // Chrome recorded it; we did not
    await h.pipeline.onVisited({ url: 'https://during.example/', title: 'During', lastVisitTime: NOW - 1000 });
    expect(urls(h, 'during')).toEqual([]);
    await h.pipeline.updateSettings({ paused: false });
    await expect.poll(() => urls(h, 'during')).toEqual(['https://during.example/']);
    expect((await h.pipeline.status()).paused).toBe(false);
  });
  it('pausing during the initial import stops it cleanly with a checkpoint; resuming completes it without duplicates', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => visit(`https://site${i}.example/p`, `Site ${i}`, i * 3));
    const h = await harness(rows);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.updateSettings({ paused: true });
    await h.pipeline.resumeImport();
    const mid = await h.state.read();
    expect(mid.consent).not.toBeNull();
    await h.pipeline.updateSettings({ paused: false });
    await h.pipeline.resumeImport();
    await expect.poll(async () => (await h.state.read()).import.status).toBe('complete');
    expect(h.store.stats().pages).toBe(30);
  });
  it('a restart while paused stays paused (onWake does not resume work)', async () => {
    const h = await harness([visit('https://a.example/', 'A', 1)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.resumeImport();
    await h.pipeline.updateSettings({ paused: true });
    h.calls.length = 0;
    await h.restart().onWake();
    expect(h.calls).toEqual([]);
    expect((await h.state.read()).settings.paused).toBe(true);
  });
});

describe('mirrored deletion toggle', () => {
  it('on (default): Chrome deleting a recent URL deletes our copy; off: our copy stays, saved always stays', async () => {
    for (const mirror of [true, false]) {
      const h = await harness([visit('https://gone.example/x', 'Gone', 2)]);
      await h.pipeline.grantConsent(CONSENT_VERSION);
      await h.pipeline.resumeImport();
      await h.pipeline.updateSettings({ mirrorDeletion: mirror });
      await h.pipeline.onVisitRemoved({ allHistory: false, urls: ['https://gone.example/x'] });
      expect(urls(h, 'gone')).toEqual(mirror ? [] : ['https://gone.example/x']);
      await h.pipeline.onVisitRemoved({ allHistory: true, urls: [] });
      expect(urls(h, 'gone')).toEqual(mirror ? [] : ['https://gone.example/x']);
    }
  });
});

describe('retention and storage cap come from settings', () => {
  it('retention 3 months removes older history; null keeps everything; saved never expires', async () => {
    const h = await harness([visit('https://fresh.example/', 'Fresh', 5), visit('https://old.example/', 'Old', 150), visit('https://ancient.example/', 'Ancient', 700)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.resumeImport();
    h.store.savePage({ url: 'https://ancient.example/', title: 'Ancient', body: 'kept', savedAt: NOW });
    await h.pipeline.updateSettings({ retentionMonths: null });
    await h.pipeline.onAlarm(ALARM_MAINTENANCE);
    expect(h.store.stats().pages).toBe(3);
    await h.pipeline.updateSettings({ retentionMonths: 3 });
    await h.pipeline.onAlarm(ALARM_MAINTENANCE);
    expect(urls(h, 'old')).toEqual([]);
    expect(urls(h, 'fresh')).toHaveLength(1);
    expect(urls(h, 'ancient')).toHaveLength(1); // saved survives
  });
  it('the cap is passed to the engine as capMb × 1,000,000 bytes', async () => {
    const h = await harness([]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.updateSettings({ capMb: 250 });
    const seen: unknown[] = [];
    const engine = { call: async (c: { method: string; params?: unknown }) => (seen.push(c), c.method === 'integrityCheck' ? { ok: true } : {}) } as never;
    const { runMaintenance } = await import('../src/background/pipeline/maintenance');
    await runMaintenance({ engine, state: h.state, now: () => NOW });
    expect(seen).toContainEqual({ method: 'enforceCap', params: { maxBytes: 250_000_000 } });
    expect(seen[0]).toEqual({ method: 'applyRetention', params: { months: 12, now: NOW } });
  });
});

describe('ledger', () => {
  it('domainStats groups pages per site with sizes; pageInfo shows exactly what is stored and nothing for unknown pages', async () => {
    const { store } = await newStore();
    store.upsertHistory([{ url: 'https://a.example/1', title: 'One', lastVisitTime: NOW - DAY, visitCount: 3 }, { url: 'https://a.example/2', title: 'Two', lastVisitTime: NOW - 2 * DAY, visitCount: 1 }, { url: 'https://b.example/', title: 'B', lastVisitTime: NOW, visitCount: 1 }]);
    store.upsertContent({ url: 'https://a.example/1', title: 'One', headings: 'H', description: 'D', body: 'x'.repeat(2000), indexedAt: NOW });
    store.savePage({ url: 'https://b.example/', title: 'B', body: 'kept', savedAt: NOW });
    const rows = store.domainStats(10);
    expect(rows.map((r) => r.domain)).toEqual(['a.example', 'b.example']); // biggest text first
    expect(rows[0]).toMatchObject({ pages: 2, saved: 0, withContent: 1 });
    expect(rows[0]?.textBytes).toBeGreaterThan(2000);
    expect(rows[1]).toMatchObject({ pages: 1, saved: 1 });
    const info = store.pageInfo('https://a.example/1#frag');
    expect(info).toMatchObject({ url: 'https://a.example/1', title: 'One', visitCount: 3, flags: { history: true, content: true, saved: false }, headings: 'H', description: 'D', snippets: 0 });
    expect(info?.bodyPreview.length).toBe(600); // never more than the preview
    expect(store.pageInfo('https://nothing.example/')).toBeNull();
    expect(store.pageInfo('not a url')).toBeNull();
    expect(store.domainStats(1)).toHaveLength(1);
  });
});

describe('delete controls and export/import', () => {
  it('delete range removes history in [start,end) and keeps saved; delete site honours includeSaved; clear Deep text keeps history', async () => {
    const { store } = await newStore();
    store.upsertHistory([{ url: 'https://s.example/old', title: 'Old', lastVisitTime: NOW - 40 * DAY }, { url: 'https://s.example/new', title: 'New', lastVisitTime: NOW - DAY }, { url: 'https://t.example/', title: 'T', lastVisitTime: NOW - 41 * DAY }]);
    store.savePage({ url: 'https://t.example/', title: 'T', body: 'kept page', savedAt: NOW });
    expect(store.deleteRange(NOW - 50 * DAY, NOW - 30 * DAY)).toMatchObject({ deletedPages: 1, keptSaved: 1 });
    expect(store.search({ query: 'old', now: NOW }).results).toEqual([]);
    expect(store.search({ query: 'kept', now: NOW }).results).toHaveLength(1);
    expect(store.deleteDomain('t.example', false)).toMatchObject({ keptSaved: 1 });
    expect(store.search({ query: 'kept', now: NOW }).results).toHaveLength(1);
    expect(store.deleteDomain('t.example', true).deletedPages).toBe(1);
    expect(store.search({ query: 'kept', now: NOW }).results).toEqual([]);
  });
  it('export → validate → import round-trips saved items; malformed files fail the schema without touching the store', async () => {
    const a = (await newStore()).store;
    a.savePage({ url: 'https://k.example/p', title: 'Keep me', body: 'precious words', savedAt: NOW });
    a.addSnippet({ url: 'https://k.example/p', pageTitle: 'Keep me', text: 'a quote', createdAt: NOW });
    const exported = a.exportData('saved', NOW);
    const text = JSON.stringify(exported);
    const b = (await newStore()).store;
    const parsed = exportDataSchema.safeParse(JSON.parse(text));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(b.importData(parsed.data)).toMatchObject({ pages: 1, snippets: 1 });
    expect(b.search({ query: 'precious', now: NOW }).results).toHaveLength(1);
    for (const bad of ['{}', '[]', 'null', JSON.stringify({ ...exported, version: 2 }), JSON.stringify({ ...exported, format: 'other' }), JSON.stringify({ ...exported, pages: [{ url: 5 }] })]) expect(exportDataSchema.safeParse(JSON.parse(bad)).success).toBe(false);
    expect(b.stats().pages).toBe(1);
  });
});

describe('live visits that arrive without a title', () => {
  it('schedule ONE title-refresh alarm; the alarm re-reads recent history and fills the title in; paused skips it', async () => {
    const items = [visit('https://x.example/', 'Earlier', 3)];
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.resumeImport();
    await h.pipeline.onVisited({ url: 'https://news.example/story', title: '', lastVisitTime: NOW - 1000, visitCount: 1 });
    await h.pipeline.onVisited({ url: 'https://news.example/other', lastVisitTime: NOW - 500, visitCount: 1 });
    expect(h.alarms.created.filter((n) => n === ALARM_TITLE_REFRESH)).toHaveLength(1); // not reset by the second visit
    expect(h.store.search({ query: 'story', now: NOW }).results[0]?.title).toBe('');
    items.push(visit('https://news.example/story', 'Big Story Headline', 0, { lastVisitTime: NOW - 1000 })); // Chrome now knows the title
    await h.pipeline.updateSettings({ paused: true });
    await h.pipeline.onAlarm(ALARM_TITLE_REFRESH);
    expect(h.store.search({ query: 'headline', now: NOW }).results).toEqual([]); // paused: nothing runs
    await h.pipeline.updateSettings({ paused: false });
    await h.pipeline.onAlarm(ALARM_TITLE_REFRESH);
    expect(h.store.search({ query: 'headline', now: NOW }).results.map((r) => r.url)).toEqual(['https://news.example/story']);
  });
  it('a visit that already has a title schedules nothing', async () => {
    const h = await harness([]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await h.pipeline.resumeImport();
    await h.pipeline.onVisited({ url: 'https://t.example/', title: 'Titled', lastVisitTime: NOW, visitCount: 1 });
    expect(h.alarms.created).not.toContain(ALARM_TITLE_REFRESH);
  });
});
