// Service-worker side of the engine protocol. Ensures the offscreen document exists, sends a validated call, and recovers
// from the transient failures measured in M0 S3 (A3): "receiving end does not exist" while the document is still starting,
// "message channel closed" when it was closed mid-request, and a worker that died ("engine-unavailable").
// Every engine call is safe to retry: reads are pure; writes are upserts/idempotent deletes inside one SQLite transaction,
// so an interrupted call either committed completely or not at all.
import type { EngineCall, EngineInfo, EngineResults } from '../engine/contract';
import { EngineError } from '../engine/errors';
import { isTransientMessagingError } from '../shared/errors';
import { engineCallResultSchema, type EngineMessage } from '../shared/messages';
import { retryWithBackoff, type RetryOptions } from '../shared/retry';
import type { OffscreenManager } from './offscreen-manager';

export interface EngineClientDeps {
  offscreen: OffscreenManager;
  sendMessage: (message: EngineMessage) => Promise<unknown>;
  retry?: Partial<RetryOptions>;
}

export const DEFAULT_ENGINE_RETRY = { attempts: 8, baseDelayMs: 50, maxDelayMs: 1000 } as const;

/** Retry only "the engine went away" conditions. open-failed (already retried inside the worker), db-too-new, bad-request, internal are final. */
export const isRetryableEngineError = (error: unknown): boolean => isTransientMessagingError(error) || (error instanceof EngineError && error.code === 'engine-unavailable');

export function createEngineClient(deps: EngineClientDeps) {
  const retryOptions: RetryOptions = { ...DEFAULT_ENGINE_RETRY, isRetryable: isRetryableEngineError, ...deps.retry };
  async function call<C extends EngineCall>(request: C): Promise<EngineResults[C['method']]> {
    return retryWithBackoff(async () => {
      await deps.offscreen.ensure(); // re-checked on every attempt: the document may have been closed since the last one
      const raw = await deps.sendMessage({ target: 'engine', type: 'engine/call', call: request });
      const parsed = engineCallResultSchema.safeParse(raw);
      if (!parsed.success) throw new Error('engine returned a malformed response');
      if (!parsed.data.ok) throw new EngineError(parsed.data.error.code, parsed.data.error.message);
      return parsed.data.data as EngineResults[C['method']];
    }, retryOptions);
  }
  return { call, ping: (): Promise<EngineInfo> => call({ method: 'ping' }) };
}
