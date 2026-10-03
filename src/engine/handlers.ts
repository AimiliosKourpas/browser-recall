import type { EngineInfo, EngineRequest, EngineResponse } from './contract';

/** Pure request handler (unit-testable without a Worker). */
export function handleRequest(request: EngineRequest, info: EngineInfo): EngineResponse {
  switch (request.method) {
    case 'ping':
      return { id: request.id, ok: true, result: info };
  }
}
