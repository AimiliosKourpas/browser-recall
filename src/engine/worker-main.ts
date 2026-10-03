// The engine worker: the SINGLE owner of the database (ADR-002). It opens the OPFS database lazily with bounded retry
// (A3), validates every request, and answers with typed results/errors. Reopening after an offscreen restart is just
// "start a new worker": the data lives in OPFS, not in this process.
import { ENGINE_PROTOCOL_VERSION, WORKER_READY, engineRequestSchema, type EngineInfo, type EngineResponse } from './contract';
import { EngineError, type EngineErrorCode } from './errors';
import { handleCall } from './handlers';
import { openOpfsDb } from './sqlite';
import { SearchStore } from './store';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  location?: { href: string };
}

export interface WorkerDeps {
  openStore: () => Promise<SearchStore>;
}

function defaultDeps(scope: WorkerScope): WorkerDeps {
  return {
    openStore: async () => SearchStore.open(await openOpfsDb({ wasmUrl: new URL('sqlite3.wasm', scope.location?.href ?? self.location.href).href })),
  };
}

export function serializeError(error: unknown): { code: EngineErrorCode; message: string } {
  if (error instanceof EngineError) return { code: error.code, message: error.message };
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) };
}

export function startEngineWorker(scope: WorkerScope = self as unknown as WorkerScope, deps: WorkerDeps = defaultDeps(scope)): void {
  const info: EngineInfo = { protocol: ENGINE_PROTOCOL_VERSION, instanceId: crypto.randomUUID() };
  let store: Promise<SearchStore> | undefined;
  // A failed open is NOT cached: the next call retries (each attempt is itself bounded), so recovery needs no restart.
  const getStore = () => {
    store ??= deps.openStore().catch((error: unknown) => {
      store = undefined;
      throw error;
    });
    return store;
  };
  // calls are processed one at a time: single owner, no interleaving of multi-statement operations
  let queue: Promise<void> = Promise.resolve();
  scope.onmessage = (event) => {
    const parsed = engineRequestSchema.safeParse(event.data);
    if (!parsed.success) return; // untrusted shape: ignore
    const { id, call } = parsed.data;
    queue = queue.then(async () => {
      let response: EngineResponse;
      try {
        response = { id, ok: true, result: await handleCall(call, { info, getStore }) };
      } catch (error) {
        response = { id, ok: false, error: serializeError(error) };
      }
      scope.postMessage(response);
    });
  };
  scope.postMessage(WORKER_READY);
}
