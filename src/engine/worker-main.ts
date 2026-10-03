// The single owner of engine state (ADR-002: one worker holds the OPFS database from M2 on). In M1 it only answers ping.
import { ENGINE_PROTOCOL_VERSION, WORKER_READY, engineRequestSchema, type EngineInfo, type EngineResponse } from './contract';
import { handleRequest } from './handlers';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

export function startEngineWorker(scope: WorkerScope = self as unknown as WorkerScope): void {
  const info: EngineInfo = { protocol: ENGINE_PROTOCOL_VERSION, instanceId: crypto.randomUUID() };
  scope.onmessage = (event) => {
    const parsed = engineRequestSchema.safeParse(event.data);
    if (!parsed.success) return; // untrusted shape: ignore
    const response: EngineResponse = handleRequest(parsed.data, info);
    scope.postMessage(response);
  };
  scope.postMessage(WORKER_READY);
}
