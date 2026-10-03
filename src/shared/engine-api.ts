// What UI pages use to talk to the engine: one typed function over the service-worker gate. UI code never sees SQLite.
import type { EngineCall, EngineResults } from '../engine/contract';
import { EngineError } from '../engine/errors';
import { engineCallResultSchema } from './messages';

export async function engineCall<C extends EngineCall>(call: C): Promise<EngineResults[C['method']]> {
  const raw: unknown = await chrome.runtime.sendMessage({ type: 'sw/engine', call });
  const parsed = engineCallResultSchema.safeParse(raw);
  if (!parsed.success) throw new EngineError('internal', 'unexpected response from the service worker');
  if (!parsed.data.ok) throw new EngineError(parsed.data.error.code, parsed.data.error.message);
  return parsed.data.data as EngineResults[C['method']];
}
