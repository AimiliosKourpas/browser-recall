// Typed, validated extension messages (ARCHITECTURE §7). Every listener parses with these schemas and checks the sender;
// anything that fails is ignored. Responses use the Result envelope so errors cross the messaging boundary as data.
import { z } from 'zod';
import { engineInfoSchema } from '../engine/contract';

/** UI page -> service worker */
export const swMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sw/ensure-engine') }),
  z.object({ type: z.literal('sw/open-search') }),
]);
export type SwMessage = z.infer<typeof swMessageSchema>;

/** service worker -> offscreen document */
export const engineMessageSchema = z.object({ target: z.literal('engine'), type: z.literal('engine/ping') });
export type EngineMessage = z.infer<typeof engineMessageSchema>;

export const errorSchema = z.object({ code: z.enum(['engine-unavailable', 'bad-request', 'internal']), message: z.string() });

export const resultSchema = <T extends z.ZodType>(data: T) =>
  z.union([z.object({ ok: z.literal(true), data }), z.object({ ok: z.literal(false), error: errorSchema })]);

export type Result<T> = { ok: true; data: T } | { ok: false; error: z.infer<typeof errorSchema> };

export const ensureEngineResultSchema = resultSchema(engineInfoSchema);
export const openSearchResultSchema = resultSchema(z.object({ opened: z.literal(true) }));
export const pingResultSchema = resultSchema(engineInfoSchema);

export interface SenderLike {
  id?: string | undefined;
  url?: string | undefined;
}

/** Messages from our own extension pages (search, onboarding, options): same extension id AND an extension-origin URL. */
export function isTrustedExtensionPage(sender: SenderLike, runtimeId: string): boolean {
  return sender.id === runtimeId && typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${runtimeId}/`);
}

/** Messages from any context of this extension (service worker, offscreen document, pages): same extension id. */
export function isOwnExtension(sender: SenderLike, runtimeId: string): boolean {
  return sender.id === runtimeId;
}
