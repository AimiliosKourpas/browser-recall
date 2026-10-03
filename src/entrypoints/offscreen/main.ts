// Offscreen document (reason WORKERS): hosts the engine worker and answers validated engine messages from the service worker.
import { WorkerClient } from '../../engine/worker-client';
import { engineMessageSchema, isOwnExtension, type Result } from '../../shared/messages';
import type { EngineInfo } from '../../engine/contract';

const client = new WorkerClient(new Worker(chrome.runtime.getURL('/engine-worker.js')));

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const parsed = engineMessageSchema.safeParse(raw);
  if (!parsed.success || !isOwnExtension(sender, chrome.runtime.id)) return false;
  client
    .call('ping')
    .then((info): Result<EngineInfo> => ({ ok: true, data: info }))
    .catch((error: unknown): Result<EngineInfo> => ({ ok: false, error: { code: 'engine-unavailable', message: error instanceof Error ? error.message : String(error) } }))
    .then(sendResponse);
  return true;
});
