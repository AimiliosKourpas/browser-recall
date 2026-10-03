// Offscreen document (reason WORKERS): hosts the engine worker and answers validated engine messages from the service worker.
import { EngineError } from '../../engine/errors';
import { WorkerClient } from '../../engine/worker-client';
import { EngineInterruptedError } from '../../shared/errors';
import { engineMessageSchema, isOwnExtension, type Result } from '../../shared/messages';

const client = new WorkerClient(new Worker(chrome.runtime.getURL('/engine-worker.js')));

function toError(error: unknown): Result<never> {
  if (error instanceof EngineError) return { ok: false, error: { code: error.code, message: error.message } };
  const code = error instanceof EngineInterruptedError ? 'engine-unavailable' : 'internal';
  return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } };
}

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const parsed = engineMessageSchema.safeParse(raw);
  if (!parsed.success || !isOwnExtension(sender, chrome.runtime.id)) return false;
  client
    .call(parsed.data.call)
    .then((data): Result<unknown> => ({ ok: true, data }))
    .catch(toError)
    .then(sendResponse);
  return true;
});
