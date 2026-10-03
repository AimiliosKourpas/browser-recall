// Request/response contract between the offscreen host and the engine worker. Pure types and schemas: no chrome.* here.
// M2 extends `engineRequestSchema` / `EngineResults` with the SearchStore methods; every method is validated at the worker boundary.
import { z } from 'zod';

export const ENGINE_PROTOCOL_VERSION = 1;

export const engineInfoSchema = z.object({
  protocol: z.literal(ENGINE_PROTOCOL_VERSION),
  /** Changes every time the worker is (re)created: lets callers detect a restarted engine. */
  instanceId: z.string().min(1),
});
export type EngineInfo = z.infer<typeof engineInfoSchema>;

export const engineRequestSchema = z.discriminatedUnion('method', [z.object({ id: z.number().int().nonnegative(), method: z.literal('ping') })]);
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EngineMethod = EngineRequest['method'];

export interface EngineResults {
  ping: EngineInfo;
}

export type EngineResponse =
  | { id: number; ok: true; result: EngineInfo }
  | { id: number; ok: false; error: { message: string } };

export const WORKER_READY = { ready: true } as const;
