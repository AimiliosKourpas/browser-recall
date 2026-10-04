// Bounded, resumable history import (M0 S8): newest → oldest in 7-day windows, large maxResults per window, a window that
// comes back full is split in halves, engine writes in batches of <= 1000 rows (the engine serialises calls, so bigger
// batches would block searches). The checkpoint (`nextEnd`) is persisted after EVERY window; re-running is idempotent
// (the engine upserts by normalised URL), so an interrupted import resumes where it stopped.
import type { HistoryRow, UpsertSummary } from '../../engine/model';
import { hasValidConsent, type StateStore } from './state';

export const WINDOW_MS = 7 * 86_400_000;
export const MAX_RESULTS = 50_000;
export const BATCH_ROWS = 1000;
const MIN_SPLIT_MS = 1000;

export interface HistoryItemLike {
  url?: string | undefined;
  title?: string | undefined;
  lastVisitTime?: number | undefined;
  visitCount?: number | undefined;
  typedCount?: number | undefined;
}

export interface HistorySearch {
  search(query: { text: string; startTime: number; endTime: number; maxResults: number }): Promise<HistoryItemLike[]>;
}

export interface ImportDeps {
  history: HistorySearch;
  upsert: (rows: HistoryRow[]) => Promise<UpsertSummary>;
  state: StateStore;
  now: () => number;
  /** polled between windows; true = stop cleanly (state is already checkpointed) */
  shouldStop?: () => boolean;
}

export const isHttpUrl = (url: string | undefined): url is string => typeof url === 'string' && /^https?:\/\//i.test(url);

export function toRow(item: HistoryItemLike): HistoryRow | undefined {
  if (!isHttpUrl(item.url) || typeof item.lastVisitTime !== 'number' || !Number.isFinite(item.lastVisitTime)) return undefined;
  return {
    url: item.url,
    ...(item.title ? { title: item.title } : {}),
    lastVisitTime: Math.max(0, item.lastVisitTime),
    ...(item.visitCount !== undefined ? { visitCount: item.visitCount } : {}),
    ...(item.typedCount !== undefined ? { typedCount: item.typedCount } : {}),
  };
}

/** Smallest instant t such that some history item was last visited before t (binary search, ~42 cheap queries); undefined if history is empty. */
export async function findEarliestVisit(history: HistorySearch, now: number): Promise<number | undefined> {
  const anyBefore = async (t: number) => (await history.search({ text: '', startTime: 0, endTime: t, maxResults: 1 })).length > 0;
  if (!(await anyBefore(now + 1))) return undefined;
  let lo = 0;
  let hi = now + 1; // invariant: anyBefore(hi) is true, anyBefore(lo) is false
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await anyBefore(mid)) hi = mid;
    else lo = mid;
  }
  return Math.max(0, hi - 1);
}

interface RangeResult {
  processed: number;
  skipped: number;
}

/** Imports [start, end) (a window that returns MAX_RESULTS rows is split and each half imported separately). */
export async function importRange(deps: Pick<ImportDeps, 'history' | 'upsert'>, start: number, end: number): Promise<RangeResult> {
  const items = await deps.history.search({ text: '', startTime: Math.max(0, start - 1), endTime: end, maxResults: MAX_RESULTS });
  if (items.length >= MAX_RESULTS && end - start > MIN_SPLIT_MS) {
    const mid = Math.floor((start + end) / 2);
    const newer = await importRange(deps, mid, end);
    const older = await importRange(deps, start, mid);
    return { processed: newer.processed + older.processed, skipped: newer.skipped + older.skipped };
  }
  const rows: HistoryRow[] = [];
  let skipped = 0;
  for (const item of items) {
    const row = toRow(item);
    if (row) rows.push(row);
    else skipped++;
  }
  let processed = 0;
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const summary = await deps.upsert(rows.slice(i, i + BATCH_ROWS));
    processed += summary.inserted + summary.updated;
    skipped += summary.skipped;
  }
  return { processed, skipped };
}

/** The initial import. Requires consent; resumes from the persisted checkpoint; no-op once complete. */
export async function runInitialImport(deps: ImportDeps): Promise<'complete' | 'stopped' | 'no-consent'> {
  let s = await deps.state.read();
  if (!hasValidConsent(s)) return 'no-consent';
  if (s.import.status === 'complete') return 'complete';

  if (s.import.status !== 'running' || s.import.rangeStart === null || s.import.nextEnd === null) {
    const now = deps.now();
    const earliest = await findEarliestVisit(deps.history, now);
    if (earliest === undefined) {
      await deps.state.update((st) => ({ ...st, lastReconcileAt: now, import: { ...st.import, status: 'complete', rangeStart: null, nextEnd: null, startedAt: now, completedAt: now } }));
      return 'complete';
    }
    s = await deps.state.update((st) => ({ ...st, lastReconcileAt: now, import: { ...st.import, status: 'running', rangeStart: earliest, nextEnd: now + 1, startedAt: now, completedAt: null, processed: 0, skipped: 0, windows: 0 } }));
  }

  const rangeStart = s.import.rangeStart as number;
  let nextEnd = s.import.nextEnd as number;
  while (nextEnd > rangeStart) {
    if (deps.shouldStop?.()) return 'stopped';
    const start = Math.max(rangeStart, nextEnd - WINDOW_MS);
    const result = await importRange(deps, start, nextEnd);
    nextEnd = start;
    await deps.state.update((st) => ({ ...st, import: { ...st.import, nextEnd: start, processed: st.import.processed + result.processed, skipped: st.import.skipped + result.skipped, windows: st.import.windows + 1 } }));
  }
  await deps.state.update((st) => ({ ...st, reconcileDue: false, import: { ...st.import, status: 'complete', nextEnd: rangeStart, completedAt: deps.now() } }));
  return 'complete';
}

/** Daily/after-failure safety net: re-reads recent history (from the last reconcile minus a day) and upserts it (idempotent). */
export async function runReconcile(deps: ImportDeps): Promise<'done' | 'no-consent' | 'not-ready'> {
  const s = await deps.state.read();
  if (!hasValidConsent(s)) return 'no-consent';
  if (s.import.status !== 'complete') return 'not-ready'; // the initial import covers everything; reconcile starts afterwards
  const now = deps.now();
  const from = Math.max(0, (s.lastReconcileAt ?? s.import.completedAt ?? now) - 86_400_000);
  for (let end = now + 1; end > from; ) {
    const start = Math.max(from, end - WINDOW_MS);
    await importRange(deps, start, end);
    end = start;
  }
  await deps.state.update((st) => ({ ...st, lastReconcileAt: now, reconcileDue: false }));
  return 'done';
}
