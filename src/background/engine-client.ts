// Service-worker side of the engine protocol. Ensures the offscreen document exists, sends a validated request, and
// recovers from the two transient failures measured in M0 S3: "receiving end does not exist" while the document is still
// starting, and "message channel closed" when it was closed mid-request (A3). Only IDEMPOTENT requests are retried automatically.
import { engineInfoSchema, type EngineInfo } from '../engine/contract';
import { isTransientMessagingError } from '../shared/errors';
import { pingResultSchema, type EngineMessage } from '../shared/messages';
import { retryWithBackoff, type RetryOptions } from '../shared/retry';
import type { OffscreenManager } from './offscreen-manager';

export interface EngineClientDeps {
  offscreen: OffscreenManager;
  sendMessage: (message: EngineMessage) => Promise<unknown>;
  retry?: Partial<RetryOptions>;
}

export const DEFAULT_ENGINE_RETRY = { attempts: 8, baseDelayMs: 50, maxDelayMs: 1000 } as const;

export function createEngineClient(deps: EngineClientDeps) {
  const retryOptions: RetryOptions = { ...DEFAULT_ENGINE_RETRY, isRetryable: isTransientMessagingError, ...deps.retry };
  return {
    async ping(): Promise<EngineInfo> {
      return retryWithBackoff(async () => {
        await deps.offscreen.ensure(); // re-checked on every attempt: the document may have been closed since the last one
        const raw = await deps.sendMessage({ target: 'engine', type: 'engine/ping' });
        const parsed = pingResultSchema.safeParse(raw);
        if (!parsed.success) throw new Error('engine returned a malformed response');
        if (!parsed.data.ok) throw new Error(parsed.data.error.message);
        return engineInfoSchema.parse(parsed.data.data);
      }, retryOptions);
    },
  };
}
