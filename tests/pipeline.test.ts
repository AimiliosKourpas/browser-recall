import { describe, expect, it } from 'vitest';
import { ensureAlarms, ALARM_IMPORT_WATCHDOG, ALARM_MAINTENANCE, ALARM_RECONCILE } from '../src/background/pipeline/alarms';
import { planRemoval, EXPIRY_GUARD_DAYS } from '../src/background/pipeline/deletion';
import { BATCH_ROWS, MAX_RESULTS, WINDOW_MS, findEarliestVisit, importRange, runInitialImport, toRow } from '../src/background/pipeline/history-import';
import { runMaintenance } from '../src/background/pipeline/maintenance';
import { CONSENT_VERSION, STATE_KEY, createStateStore, defaultState, hasValidConsent } from '../src/background/pipeline/state';
import { acceptMessage } from '../src/background/router';
import { DAY, NOW } from './helpers/engine';
import { fakeAlarms, fakeHistory, harness, memoryStorage, rig, visit } from './helpers/pipeline';

const search = (h: Awaited<ReturnType<typeof harness>>, q: string) => h.store.search({ query: q, now: NOW }).results.map((r) => r.url);
const settle = async (h: Awaited<ReturnType<typeof harness>>) => {
  await h.pipeline.resumeImport();
};

describe('state store', () => {
  it('defaults to "no consent"; corrupt state is treated as defaults; updates are serialised and validated', async () => {
    const storage = memoryStorage();
    const store = createStateStore(storage);
    expect(hasValidConsent(await store.read())).toBe(false);
    storage.data[STATE_KEY] = { consent: 'yes please', garbage: true };
    expect(await store.read()).toEqual(defaultState());
    await Promise.all(Array.from({ length: 20 }, () => store.update((s) => ({ ...s, import: { ...s.import, processed: s.import.processed + 1 } }))));
    expect((await store.read()).import.processed).toBe(20); // no lost updates
    await expect(store.update((s) => ({ ...s, consent: { version: -1, at: 0 } }))).rejects.toThrow();
  });
  it('an outdated consent version does not count as consent', () => {
    expect(hasValidConsent({ ...defaultState(), consent: { version: CONSENT_VERSION, at: 1 } })).toBe(true);
    expect(hasValidConsent({ ...defaultState(), consent: { version: CONSENT_VERSION - 1 || 0.5, at: 1 } as never })).toBe(false);
  });
});

describe('consent gate', () => {
  const items = [visit('https://a.example/1', 'Alpha one', 1), visit('https://a.example/2', 'Alpha two', 20)];
  it('nothing is imported, synchronised or scheduled before consent', async () => {
    const h = await harness(items);
    await h.pipeline.onWake();
    await h.pipeline.onVisited(items[0]!);
    await h.pipeline.onVisitRemoved({ allHistory: true, urls: [] });
    await h.pipeline.onAlarm(ALARM_RECONCILE);
    await h.pipeline.onAlarm(ALARM_MAINTENANCE);
    await h.pipeline.onAlarm(ALARM_IMPORT_WATCHDOG);
    await settle(h);
    expect(h.history.calls).toEqual([]); // chrome.history was never even queried
    expect(h.calls).toEqual([]); // the engine was never called
    expect(h.alarms.alarms.size).toBe(0);
    expect(await h.pipeline.status()).toMatchObject({ consent: 'none', importStatus: 'idle', processed: 0 });
  });
  it('granting consent starts the import; the data becomes searchable; the grant is rejected for an unknown version', async () => {
    const h = await harness(items);
    await expect(h.pipeline.grantConsent(CONSENT_VERSION + 1)).rejects.toThrow();
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    expect(await h.pipeline.status()).toMatchObject({ consent: 'granted', importStatus: 'complete', processed: 2, progress: 1 });
    expect(search(h, 'alpha').sort()).toEqual(['https://a.example/1', 'https://a.example/2']);
  });
  it('consent persists across a service-worker restart; a restarted pipeline keeps working without asking again', async () => {
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    const again = h.restart();
    expect(await again.needsConsent()).toBe(false);
    await again.onVisited(visit('https://a.example/3', 'Alpha three', 0));
    expect(search(h, 'three')).toEqual(['https://a.example/3']);
  });
  it('revoking consent stops all processing and forgets the checkpoint, but does not touch indexed data', async () => {
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    await h.pipeline.revokeConsent();
    expect(await h.pipeline.status()).toMatchObject({ consent: 'none', importStatus: 'idle', processed: 0 });
    const before = h.history.calls.length;
    await h.pipeline.onVisited(visit('https://a.example/new', 'Brand new', 0));
    await h.pipeline.onVisitRemoved({ allHistory: true, urls: [] });
    expect(h.history.calls.length).toBe(before);
    expect(search(h, 'alpha')).toHaveLength(2); // data still there
    expect(h.alarms.alarms.size).toBe(0);
  });
});

describe('initial import', () => {
  it('filters non-http(s) rows, upserts the rest, and reports skipped', async () => {
    const h = await harness([visit('https://ok.example/', 'Fine', 1), visit('chrome://settings', 'Settings', 1), visit('chrome-extension://abc/page.html', 'Ext', 1), visit('file:///etc/hosts', 'F', 1), visit('data:text/plain,x', 'D', 1), { url: 'https://nodate.example/' }]); // the last row has no visit time and is never returned by chrome.history
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    expect(h.store.stats().pages).toBe(1);
    expect(await h.pipeline.status()).toMatchObject({ processed: 1, skipped: 4 });
  });
  it('imports newest → oldest in bounded 7-day windows, checkpointing after each window', async () => {
    const items = Array.from({ length: 30 }, (_, i) => visit(`https://w.example/${i}`, `Win ${i}`, i * 3)); // 90 days
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    const windows = h.history.calls.filter((c) => c.maxResults === MAX_RESULTS);
    expect(windows.length).toBeGreaterThanOrEqual(13);
    for (const w of windows) expect(w.endTime - w.startTime).toBeLessThanOrEqual(WINDOW_MS + 1);
    expect(windows[0]!.endTime).toBeGreaterThan(windows[windows.length - 1]!.endTime); // moving backwards in time
    expect(h.store.stats().pages).toBe(30);
    expect((await h.pipeline.status()).windows).toBe(windows.length);
  });
  it('empty history completes immediately', async () => {
    const h = await harness([]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    expect(await h.pipeline.status()).toMatchObject({ importStatus: 'complete', processed: 0 });
  });
  it('findEarliestVisit locates the oldest item', async () => {
    const hist = fakeHistory([visit('https://a.example/', 'a', 10), visit('https://b.example/', 'b', 200), visit('https://c.example/', 'c', 3)]);
    const earliest = await findEarliestVisit(hist, NOW);
    expect(earliest).toBe(NOW - 200 * DAY);
    expect(await findEarliestVisit(fakeHistory([]), NOW)).toBeUndefined();
  });
  it('a window that comes back full is split, so no row is lost to the maxResults cap', async () => {
    const seen: string[] = [];
    const big = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => visit(`https://big.example/${i}`, `Big ${i}`, 0.001 + (i % 1000) * 0.0001));
    const res = await importRange({ history: fakeHistory(big), upsert: async (batch) => (seen.push(...batch.map((b) => b.url)), { inserted: batch.length, updated: 0, skipped: 0 }) }, NOW - DAY, NOW);
    expect(new Set(seen).size).toBe(MAX_RESULTS + 5);
    expect(res.processed).toBe(MAX_RESULTS + 5);
  }, 60_000);
  it('writes to the engine in batches of at most BATCH_ROWS', async () => {
    const items = Array.from({ length: 2500 }, (_, i) => visit(`https://b.example/${i}`, `B ${i}`, 0.5));
    const sizes: number[] = [];
    await importRange({ history: fakeHistory(items), upsert: async (rows) => (sizes.push(rows.length), { inserted: rows.length, updated: 0, skipped: 0 }) }, NOW - DAY, NOW);
    expect(sizes).toEqual([BATCH_ROWS, BATCH_ROWS, 500]);
  });
  it('toRow rejects bad rows and keeps optional fields optional', () => {
    expect(toRow({ url: 'https://a.example/', lastVisitTime: 5 })).toEqual({ url: 'https://a.example/', lastVisitTime: 5 });
    expect(toRow({ url: 'ftp://a.example/', lastVisitTime: 5 })).toBeUndefined();
    expect(toRow({ url: 'https://a.example/' })).toBeUndefined();
    expect(toRow({ url: 'https://a.example/', lastVisitTime: Number.NaN })).toBeUndefined();
  });
});

describe('resume and idempotence', () => {
  const items = Array.from({ length: 40 }, (_, i) => visit(`https://r.example/${i}`, `Resume ${i}`, i * 2));
  it('an interrupted import resumes from its checkpoint (not from scratch) and ends complete with no duplicates', async () => {
    const h = await harness(items);
    let windows = 0;
    // interrupt: the engine starts failing after 3 windows' worth of calls
    const realCall = h.engine.call.bind(h.engine);
    let dead = false;
    h.engine.call = (async (c: never) => {
      if (dead) throw new Error('service worker killed');
      if ((c as { method: string }).method === 'upsertHistory' && ++windows > 3) {
        dead = true;
        throw new Error('service worker killed');
      }
      return realCall(c);
    }) as never;
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    const mid = await h.pipeline.status();
    expect(mid.importStatus).toBe('running');
    expect(mid.windows).toBeGreaterThan(0);
    const pagesAtInterrupt = h.store.stats().pages;
    expect(pagesAtInterrupt).toBeLessThan(40);
    // "restart": a new pipeline instance over the same storage and the same (healthy) engine
    const callsBefore = h.history.calls.length;
    const restarted = rig(h.store, items, h.storage).pipeline;
    await restarted.onWake();
    await restarted.resumeImport();
    expect(await restarted.status()).toMatchObject({ importStatus: 'complete', progress: 1 });
    expect(h.store.stats().pages).toBe(40); // everything, exactly once
    expect(h.history.calls.length).toBe(callsBefore); // (the restarted rig has its own history spy)
  });
  it('re-importing the same history changes nothing (idempotent upserts)', async () => {
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    const before = h.store.exportData('all', 0);
    await h.state.update((s) => ({ ...s, import: { ...s.import, status: 'idle' } })); // force a full re-import
    await settle(h);
    expect(h.store.exportData('all', 0)).toEqual(before);
    expect(h.store.stats().pages).toBe(40);
  });
  it('the watchdog alarm resumes a stalled import; a completed import is never re-run', async () => {
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    const calls = h.history.calls.length;
    await h.pipeline.onAlarm(ALARM_IMPORT_WATCHDOG);
    expect(h.history.calls.length).toBe(calls);
    expect(await runInitialImport({ history: h.history, upsert: async () => ({ inserted: 0, updated: 0, skipped: 0 }), state: h.state, now: () => NOW })).toBe('complete');
  });
  it('transient engine failure during import leaves state "running" so the watchdog can retry', async () => {
    const h = await harness(items, { engineFailures: 1 });
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    expect((await h.pipeline.status()).importStatus).toBe('running');
    await h.pipeline.onAlarm(ALARM_IMPORT_WATCHDOG);
    expect(await h.pipeline.status()).toMatchObject({ importStatus: 'complete' });
    expect(h.store.stats().pages).toBe(40);
  });
});

describe('live synchronisation', () => {
  async function consented() {
    const h = await harness([]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    return h;
  }
  it('a new visit is indexed; repeated and out-of-order events are idempotent; counts and latest time win', async () => {
    const h = await consented();
    const v = visit('https://live.example/page#x', 'Live page', 0, { visitCount: 1 });
    await h.pipeline.onVisited(v);
    await h.pipeline.onVisited(v);
    await h.pipeline.onVisited({ ...v, visitCount: 3, lastVisitTime: NOW + 1000 });
    await h.pipeline.onVisited({ ...v, visitCount: 2, lastVisitTime: NOW - 5000 }); // stale duplicate
    expect(h.store.stats().pages).toBe(1);
    expect(h.store.search({ query: 'live', now: NOW + 2000 }).results[0]).toMatchObject({ timestamp: NOW + 1000 });
  });
  it('a visit with an empty title (onVisited fires before the page loads) does not erase a known title', async () => {
    const h = await consented();
    await h.pipeline.onVisited(visit('https://t.example/', 'Real title', 1));
    await h.pipeline.onVisited({ url: 'https://t.example/', lastVisitTime: NOW, visitCount: 2 });
    expect(search(h, 'real')).toEqual(['https://t.example/']);
  });
  it('ignores non-http(s) URLs', async () => {
    const h = await consented();
    // eslint-disable-next-line no-script-url -- the URL under test is data, never executed
    const urls = ['chrome://settings', 'chrome-extension://abc/x.html', 'file:///x', 'data:text/html,x', 'javascript:void(0)', 'about:blank'];
    for (const url of urls) await h.pipeline.onVisited({ url, title: 'x', lastVisitTime: NOW });
    expect(h.store.stats().pages).toBe(0);
  });
  it('a transient engine failure marks reconcile as due instead of losing the visit; the reconcile then recovers it', async () => {
    const h = await harness([visit('https://missed.example/', 'Missed visit', 0)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    h.store.deleteEverything(); // pretend the visit never made it
    h.failNext(1);
    await h.pipeline.onVisited(visit('https://missed.example/', 'Missed visit', 0));
    expect(h.store.stats().pages).toBe(0);
    expect((await h.state.read()).reconcileDue).toBe(true);
    h.clock.now += 3600_000;
    await h.pipeline.onAlarm(ALARM_RECONCILE);
    expect(search(h, 'missed')).toEqual(['https://missed.example/']);
    expect((await h.state.read()).reconcileDue).toBe(false);
  });
  it('the daily reconcile re-reads only recent history (from the last reconcile minus a day)', async () => {
    const h = await harness([visit('https://old.example/', 'Old', 60), visit('https://new.example/', 'New', 0.2)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    h.history.calls.length = 0;
    h.clock.now += 2 * DAY;
    await h.pipeline.onAlarm(ALARM_RECONCILE);
    expect(h.history.calls.length).toBeGreaterThan(0);
    expect(Math.min(...h.history.calls.map((c) => c.startTime))).toBeGreaterThan(NOW - 3 * DAY);
  });
});

describe('deletion mirroring and the 85-day expiry guard (ADR-006, A5)', () => {
  async function consented(items: Parameters<typeof harness>[0]) {
    const h = await harness(items);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    return h;
  }
  const items = [visit('https://recent.example/a', 'Recent alpha', 3), visit('https://recent.example/b', 'Recent beta', 10), visit('https://ancient.example/c', 'Ancient gamma', EXPIRY_GUARD_DAYS + 10), visit('https://keep.example/s', 'Saved delta', 5)];
  it('an explicit recent deletion is mirrored', async () => {
    const h = await consented(items);
    await h.pipeline.onVisitRemoved({ allHistory: false, urls: ['https://recent.example/a#frag'] });
    expect(search(h, 'alpha')).toEqual([]);
    expect(search(h, 'beta')).toEqual(['https://recent.example/b']);
  });
  it('Chrome\'s automatic expiry of an old URL (same event shape) does NOT erase the archive', async () => {
    const h = await consented(items);
    await h.pipeline.onVisitRemoved({ allHistory: false, urls: ['https://ancient.example/c'] });
    expect(search(h, 'gamma')).toEqual(['https://ancient.example/c']);
    // the boundary: 84 days is still "recent" (mirrored), 86 days is expiry (ignored)
    const edge = await consented([visit('https://edge.example/84', 'Edge eighty', EXPIRY_GUARD_DAYS - 1), visit('https://edge.example/86', 'Edge ninety', EXPIRY_GUARD_DAYS + 1)]);
    await edge.pipeline.onVisitRemoved({ allHistory: false, urls: ['https://edge.example/84', 'https://edge.example/86'] });
    expect(search(edge, 'edge')).toEqual(['https://edge.example/86']);
  });
  it('a mixed batch (expiry events carry many URLs) mirrors the recent ones and keeps the old ones', async () => {
    const h = await consented(items);
    await h.pipeline.onVisitRemoved({ allHistory: false, urls: ['https://recent.example/a', 'https://ancient.example/c', 'https://never-seen.example/'] });
    expect(search(h, 'alpha')).toEqual([]);
    expect(search(h, 'gamma')).toHaveLength(1);
  });
  it('saved pages survive: single deletion only clears the history flag; delete-all keeps saved pages and snippets', async () => {
    const h = await consented(items);
    h.store.savePage({ url: 'https://keep.example/s', title: 'Saved delta', body: 'precious notes', savedAt: NOW });
    h.store.addSnippet({ url: 'https://keep.example/s', text: 'a precious quote', createdAt: NOW });
    await h.pipeline.onVisitRemoved({ allHistory: false, urls: ['https://keep.example/s'] });
    expect(search(h, 'precious')).toContain('https://keep.example/s');
    expect(h.store.search({ query: 'delta', now: NOW }).results[0]?.flags.history).toBe(false);
    await h.pipeline.onVisitRemoved({ allHistory: true, urls: [] });
    const stats = h.store.stats();
    expect(stats).toMatchObject({ pages: 1, saved: 1, snippets: 1 });
    expect(search(h, 'alpha')).toEqual([]);
    expect(search(h, 'gamma')).toEqual([]); // delete-all is always user-initiated: even old pages go
    expect(h.store.integrityCheck().ok).toBe(true);
  });
  it('repeated deletion events are safe; partial-visit events (empty url list) are no-ops', async () => {
    const h = await consented(items);
    const ev = { allHistory: false, urls: ['https://recent.example/a'] };
    await h.pipeline.onVisitRemoved(ev);
    await h.pipeline.onVisitRemoved(ev);
    await h.pipeline.onVisitRemoved({ allHistory: true, urls: [] });
    await h.pipeline.onVisitRemoved({ allHistory: true, urls: [] });
    await h.pipeline.onVisitRemoved({ allHistory: false, urls: [] });
    expect(h.store.integrityCheck().ok).toBe(true);
    const h2 = await consented(items);
    const pages = h2.store.stats().pages;
    await h2.pipeline.onVisitRemoved({ allHistory: false, urls: [] });
    expect(h2.store.stats().pages).toBe(pages);
  });
  it('planRemoval (pure): allHistory always deletes; unknown URLs ignored; mirror/guard switches', () => {
    const stored = new Map([['https://a.example/', NOW - 1 * DAY], ['https://old.example/', NOW - 200 * DAY]]);
    expect(planRemoval({ allHistory: true, urls: [] }, new Map(), NOW).deleteAllExceptSaved).toBe(true);
    expect(planRemoval({ allHistory: false, urls: ['https://a.example/', 'https://old.example/', 'https://x.example/', 'chrome://x'] }, stored, NOW)).toEqual({ deleteAllExceptSaved: false, deleteUrls: ['https://a.example/'], ignoredAsExpiry: ['https://old.example/'] });
    expect(planRemoval({ allHistory: true, urls: [] }, stored, NOW, { mirrorDeletion: false, expiryGuard: true })).toEqual({ deleteAllExceptSaved: false, deleteUrls: [], ignoredAsExpiry: [] });
    expect(planRemoval({ allHistory: false, urls: ['https://old.example/'] }, stored, NOW, { mirrorDeletion: true, expiryGuard: false }).deleteUrls).toEqual(['https://old.example/']);
  });
  it('engine lastVisits returns stored last visits for normalised URLs and omits unknown ones', async () => {
    const h = await consented(items);
    const r = h.store.lastVisits(['https://recent.example/a#x', 'https://nope.example/', 'chrome://x']);
    expect(r).toEqual([{ url: 'https://recent.example/a', lastVisit: NOW - 3 * DAY }]);
  });
});

describe('scheduling and maintenance', () => {
  it('ensureAlarms creates what is missing exactly once, repairs a wrong period, and clears what is not wanted', async () => {
    const api = fakeAlarms();
    await ensureAlarms(api, { wanted: true, importRunning: true });
    expect([...api.alarms.keys()].sort()).toEqual([ALARM_IMPORT_WATCHDOG, ALARM_MAINTENANCE, ALARM_RECONCILE].sort());
    expect(api.alarms.get(ALARM_MAINTENANCE)?.periodInMinutes).toBe(1440);
    expect(api.alarms.get(ALARM_IMPORT_WATCHDOG)?.periodInMinutes).toBe(1);
    const created = api.created.length;
    await ensureAlarms(api, { wanted: true, importRunning: true });
    expect(api.created.length).toBe(created); // idempotent: no duplicates, no churn
    api.alarms.set(ALARM_RECONCILE, { name: ALARM_RECONCILE, periodInMinutes: 5 });
    await ensureAlarms(api, { wanted: true, importRunning: false });
    expect(api.alarms.get(ALARM_RECONCILE)?.periodInMinutes).toBe(1440);
    expect(api.alarms.has(ALARM_IMPORT_WATCHDOG)).toBe(false); // watchdog only while an import runs
    await ensureAlarms(api, { wanted: false, importRunning: false });
    expect(api.alarms.size).toBe(0);
  });
  it('alarms are created on consent and the watchdog disappears when the import completes', async () => {
    const h = await harness([visit('https://a.example/', 'A', 1)]);
    expect(h.alarms.alarms.size).toBe(0);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    expect([...h.alarms.alarms.keys()].sort()).toEqual([ALARM_MAINTENANCE, ALARM_RECONCILE]);
  });
  it('the maintenance alarm applies retention, the storage cap and bounded vacuum, and records the run', async () => {
    const h = await harness([visit('https://fresh.example/', 'Fresh', 5), visit('https://stale.example/', 'Stale', 400)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    expect(h.store.stats().pages).toBe(2);
    h.calls.length = 0;
    await h.pipeline.onAlarm(ALARM_MAINTENANCE);
    expect(h.calls).toEqual(['applyRetention', 'enforceCap', 'maintenance', 'integrityCheck']);
    expect(search(h, 'stale')).toEqual([]); // older than the 12-month default retention
    expect(search(h, 'fresh')).toHaveLength(1);
    const s = await h.state.read();
    expect(s.lastMaintenanceAt).toBe(NOW);
    expect(s.lastIntegrity).toEqual({ at: NOW, ok: true });
    h.calls.length = 0;
    h.clock.now += DAY; // integrity is weekly, the rest daily
    await h.pipeline.onAlarm(ALARM_MAINTENANCE);
    expect(h.calls).toEqual(['applyRetention', 'enforceCap', 'maintenance']);
  });
  it('maintenance does nothing without consent', async () => {
    const h = await harness([]);
    expect(await runMaintenance({ engine: h.engine, state: h.state, now: () => NOW })).toBe('no-consent');
    expect(h.calls).toEqual([]);
  });
  it('alarms are restored after a browser restart (onWake) when consent exists', async () => {
    const h = await harness([visit('https://a.example/', 'A', 1)]);
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    h.alarms.alarms.clear(); // Chrome dropped them
    await h.restart().onWake();
    expect([...h.alarms.alarms.keys()].sort()).toEqual([ALARM_MAINTENANCE, ALARM_RECONCILE]);
  });
});

describe('service-worker message gate for the pipeline', () => {
  const ID = 'abcdefghijklmnopabcdefghijklmnop';
  const page = { id: ID, url: `chrome-extension://${ID}/onboarding.html` };
  it('accepts consent/status messages only from our pages and only with valid shapes', () => {
    expect(acceptMessage({ type: 'sw/grant-consent', version: 1 }, page, ID)).toEqual({ type: 'sw/grant-consent', version: 1 });
    expect(acceptMessage({ type: 'sw/pipeline-status' }, page, ID)).toEqual({ type: 'sw/pipeline-status' });
    expect(acceptMessage({ type: 'sw/revoke-consent' }, page, ID)).toEqual({ type: 'sw/revoke-consent' });
    expect(acceptMessage({ type: 'sw/grant-consent', version: 'yes' }, page, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/grant-consent' }, page, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/grant-consent', version: 1 }, { id: ID, url: 'https://evil.example/' }, ID)).toBeUndefined(); // a web page / content script cannot grant consent
    expect(acceptMessage({ type: 'sw/grant-consent', version: 1 }, { id: 'other', url: 'chrome-extension://other/x.html' }, ID)).toBeUndefined();
  });
});

describe('real engine + large synthetic history through the production pipeline', () => {
  it('imports 30,000 rows in windows and batches and finishes with the right page count', async () => {
    const items = Array.from({ length: 30_000 }, (_, i) => visit(`https://${i % 500}.big.example/p/${i}`, `Synthetic page ${i} marker${i % 97}`, (i % 80) + (i % 1000) / 1000));
    const h = await harness(items);
    const t = performance.now();
    await h.pipeline.grantConsent(CONSENT_VERSION);
    await settle(h);
    const seconds = (performance.now() - t) / 1000;
    expect(await h.pipeline.status()).toMatchObject({ importStatus: 'complete', processed: 30_000 });
    expect(h.store.stats().pages).toBe(30_000);
    expect(h.store.search({ query: 'marker42', now: NOW }).results.length).toBeGreaterThan(10);
    expect(seconds, `30K rows took ${seconds.toFixed(1)} s in Node`).toBeLessThan(60);
  }, 120_000);
});
