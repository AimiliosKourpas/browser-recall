// Message routing for the service worker. Pure (dependencies injected) so it is unit-tested without Chrome.
import type { EngineInfo } from '../engine/contract';
import { isTrustedExtensionPage, swMessageSchema, type Result, type SenderLike, type SwMessage } from '../shared/messages';

export interface RouterDeps {
  ensureEngine: () => Promise<EngineInfo>;
  openSearch: () => Promise<void>;
}

/**
 * Synchronous gate: a message is handled only if it parses AND comes from one of our own extension pages.
 * Decided synchronously so the listener can return `true` (async response) only for messages it will actually answer.
 */
export function acceptMessage(raw: unknown, sender: SenderLike, runtimeId: string): SwMessage | undefined {
  const parsed = swMessageSchema.safeParse(raw);
  if (!parsed.success || !isTrustedExtensionPage(sender, runtimeId)) return undefined;
  return parsed.data;
}

export async function routeMessage(message: SwMessage, deps: RouterDeps): Promise<Result<unknown>> {
  try {
    switch (message.type) {
      case 'sw/ensure-engine':
        return { ok: true, data: await deps.ensureEngine() };
      case 'sw/open-search':
        await deps.openSearch();
        return { ok: true, data: { opened: true } };
    }
  } catch (error) {
    return { ok: false, error: { code: 'engine-unavailable', message: error instanceof Error ? error.message : String(error) } };
  }
}
