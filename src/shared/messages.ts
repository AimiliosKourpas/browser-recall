// Typed, validated extension messages (ARCHITECTURE §7). Every listener parses with these schemas and checks the sender;
// anything that fails is ignored. Responses use the Result envelope so errors cross the messaging boundary as data.
import { z } from 'zod';
import { engineCallSchema, engineInfoSchema } from '../engine/contract';
import { settingsPatchSchema, settingsSchema } from '../background/pipeline/state';

/** UI page -> service worker */
export const swMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sw/ensure-engine') }),
  /** open the search surface (overlay on the tab when possible, else the popup window); no tabId = the window */
  z.object({ type: z.literal('sw/open-search'), tabId: z.number().int().nonnegative().optional() }),
  /** from the search page inside the overlay iframe: close the overlay of the sender's tab */
  z.object({ type: z.literal('sw/overlay-close') }),
  /** onboarding: the user pressed "Allow and import history" (the consent version they saw) */
  z.object({ type: z.literal('sw/grant-consent'), version: z.number().int().positive() }),
  z.object({ type: z.literal('sw/revoke-consent') }),
  z.object({ type: z.literal('sw/pipeline-status') }),
  /** Remember / save-selection for a tab (also what the context menu and the keyboard command do); no tabId = the active tab */
  z.object({ type: z.literal('sw/remember-tab'), tabId: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal('sw/save-selection'), tabId: z.number().int().nonnegative().optional() }),
  /** Deep Search settings (M6). Enable is verified against the actual permission by the service worker. */
  z.object({ type: z.literal('sw/deep-status') }),
  z.object({ type: z.literal('sw/deep-enable') }),
  z.object({ type: z.literal('sw/deep-disable') }),
  z.object({ type: z.literal('sw/deep-exclude'), domain: z.string().min(1).max(255) }),
  z.object({ type: z.literal('sw/deep-include'), domain: z.string().min(1).max(255) }),
  z.object({ type: z.literal('sw/deep-clear') }),
  /** settings (M8): read, and a validated partial update */
  z.object({ type: z.literal('sw/settings-get') }),
  z.object({ type: z.literal('sw/settings-set'), patch: settingsPatchSchema }),
  /** any validated engine call (search, writes, deletes, maintenance…) */
  z.object({ type: z.literal('sw/engine'), call: engineCallSchema }),
]);
export type SwMessage = z.infer<typeof swMessageSchema>;

/** service worker -> offscreen document */
export const engineMessageSchema = z.object({ target: z.literal('engine'), type: z.literal('engine/call'), call: engineCallSchema });
export type EngineMessage = z.infer<typeof engineMessageSchema>;

export const errorSchema = z.object({ code: z.enum(['engine-unavailable', 'bad-request', 'open-failed', 'db-too-new', 'internal']), message: z.string() });

export const resultSchema = <T extends z.ZodType>(data: T) =>
  z.union([z.object({ ok: z.literal(true), data }), z.object({ ok: z.literal(false), error: errorSchema })]);

export type Result<T> = { ok: true; data: T } | { ok: false; error: z.infer<typeof errorSchema> };

export const ensureEngineResultSchema = resultSchema(engineInfoSchema);
export const engineCallResultSchema = resultSchema(z.unknown());
export const openSearchResultSchema = resultSchema(z.object({ opened: z.literal(true), surface: z.enum(['overlay', 'window']).optional() }));
export const settingsResultSchema = resultSchema(settingsSchema);
export const deepStatusSchema = z.object({ enabled: z.boolean(), permission: z.boolean(), consent: z.boolean(), excluded: z.array(z.string()) });
export const deepStatusResultSchema = resultSchema(deepStatusSchema);
export const pipelineStatusSchema = z.object({
  consent: z.enum(['none', 'granted', 'outdated']),
  importStatus: z.enum(['idle', 'running', 'complete']),
  processed: z.number(),
  skipped: z.number(),
  windows: z.number(),
  progress: z.number(),
  lastReconcileAt: z.number().nullable(),
  lastMaintenanceAt: z.number().nullable(),
  lastIntegrity: z.object({ at: z.number(), ok: z.boolean() }).nullable(),
  paused: z.boolean(),
});
export const pipelineStatusResultSchema = resultSchema(pipelineStatusSchema);
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
