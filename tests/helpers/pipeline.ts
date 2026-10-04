import type { EngineCall, EngineResults } from '../../src/engine/contract';
import { handleCall } from '../../src/engine/handlers';
import type { SearchStore } from '../../src/engine/store';
import type { AlarmLike, AlarmsApi } from '../../src/background/pipeline/alarms';
import { createPipeline, type PipelineDeps } from '../../src/background/pipeline/controller';
import type { HistoryItemLike, HistorySearch } from '../../src/background/pipeline/history-import';
import { createStateStore, type StorageLike } from '../../src/background/pipeline/state';
import { newStore, NOW } from './engine';

/** In-memory chrome.storage.local stand-in: survives "service-worker restarts" (new pipeline instances) in a test. */
export function memoryStorage(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (key) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

/** Fake chrome.history with the semantics M0 measured: one row per URL, newest first, startTime/endTime/maxResults. */
export function fakeHistory(items: HistoryItemLike[]): HistorySearch & { calls: { startTime: number; endTime: number; maxResults: number }[] } {
  const calls: { startTime: number; endTime: number; maxResults: number }[] = [];
  return {
    calls,
    async search(q) {
      calls.push({ startTime: q.startTime, endTime: q.endTime, maxResults: q.maxResults });
      return items
        .filter((i) => (i.lastVisitTime as number) > q.startTime && (i.lastVisitTime as number) < q.endTime)
        .sort((a, b) => (b.lastVisitTime as number) - (a.lastVisitTime as number))
        .slice(0, q.maxResults);
    },
  };
}

export function fakeAlarms(): AlarmsApi & { alarms: Map<string, AlarmLike>; created: string[]; cleared: string[] } {
  const alarms = new Map<string, AlarmLike>();
  const created: string[] = [];
  const cleared: string[] = [];
  return {
    alarms,
    created,
    cleared,
    get: async (name) => alarms.get(name),
    create: async (name, info) => (created.push(name), void alarms.set(name, { name, periodInMinutes: info.periodInMinutes })),
    clear: async (name) => (cleared.push(name), alarms.delete(name)),
  };
}

export const visit = (url: string, title: string, daysAgo: number, extra: Partial<HistoryItemLike> = {}): HistoryItemLike => ({ url, title, lastVisitTime: NOW - daysAgo * 86_400_000, visitCount: 1, typedCount: 0, ...extra });

export async function harness(items: HistoryItemLike[] = [], opts: { engineFailures?: number } = {}) {
  const { store } = await newStore();
  return rig(store, items, memoryStorage(), opts);
}

/** A pipeline over a given store/storage: build a second one over the same arguments to simulate a service-worker restart. */
export function rig(store: SearchStore, items: HistoryItemLike[], storage = memoryStorage(), opts: { engineFailures?: number } = {}) {
  let failures = opts.engineFailures ?? 0;
  const calls: EngineCall['method'][] = [];
  const engine: PipelineDeps['engine'] = {
    async call<C extends EngineCall>(call: C): Promise<EngineResults[C['method']]> {
      calls.push(call.method);
      if (failures > 0) {
        failures--;
        throw new Error('engine unavailable');
      }
      return handleCall(call, { info: { protocol: 1, instanceId: 't' }, getStore: async () => store });
    },
  };
  const history = fakeHistory(items);
  const alarms = fakeAlarms();
  const state = createStateStore(storage);
  const clock = { now: NOW };
  const make = () => createPipeline({ history, engine, state, alarms, now: () => clock.now });
  return { store, storage, history, alarms, state, engine, calls, clock, pipeline: make(), restart: make, failNext: (n: number) => (failures = n) };
}
