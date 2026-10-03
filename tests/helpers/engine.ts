import type { Db } from '../../src/engine/db';
import { openMemoryDb } from '../../src/engine/sqlite';
import { SearchStore } from '../../src/engine/store';
import type { ContentInput, HistoryRow } from '../../src/engine/model';

export const NOW = Date.UTC(2026, 9, 3, 12);
export const DAY = 86_400_000;

export async function newStore(): Promise<{ store: SearchStore; db: Db }> {
  const db = await openMemoryDb();
  return { store: SearchStore.open(db), db };
}

export const hist = (url: string, title: string, daysAgo = 1, extra: Partial<HistoryRow> = {}): HistoryRow => ({ url, title, lastVisitTime: NOW - daysAgo * DAY, visitCount: 1, typedCount: 0, ...extra });
export const content = (url: string, body: string, extra: Partial<ContentInput> = {}): ContentInput => ({ url, body, indexedAt: NOW, ...extra });
