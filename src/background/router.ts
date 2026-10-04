// Message routing for the service worker. Pure (dependencies injected) so it is unit-tested without Chrome.
import type { EngineCall, EngineInfo } from '../engine/contract';
import type { DeepController } from './deep/controller';
import { EngineError } from '../engine/errors';
import { isTrustedExtensionPage, swMessageSchema, type Result, type SenderLike, type SwMessage } from '../shared/messages';

export interface RouterDeps {
  ensureEngine: () => Promise<EngineInfo>;
  engineCall: (call: EngineCall) => Promise<unknown>;
  remember: (tabId: number | undefined, selection: boolean) => Promise<unknown>;
  pipeline: { grantConsent(version: number): Promise<void>; revokeConsent(): Promise<void>; status(): Promise<unknown> };
  openSearch: () => Promise<void>;
  deep: Pick<DeepController, 'status' | 'enable' | 'disable' | 'exclude' | 'include' | 'clear'>;
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
      case 'sw/engine':
        return { ok: true, data: await deps.engineCall(message.call) };
      case 'sw/grant-consent':
        await deps.pipeline.grantConsent(message.version);
        return { ok: true, data: await deps.pipeline.status() };
      case 'sw/revoke-consent':
        await deps.pipeline.revokeConsent();
        return { ok: true, data: await deps.pipeline.status() };
      case 'sw/pipeline-status':
        return { ok: true, data: await deps.pipeline.status() };
      case 'sw/remember-tab':
        return { ok: true, data: await deps.remember(message.tabId, false) };
      case 'sw/save-selection':
        return { ok: true, data: await deps.remember(message.tabId, true) };
      case 'sw/deep-status':
        return { ok: true, data: await deps.deep.status() };
      case 'sw/deep-enable':
        return { ok: true, data: await deps.deep.enable() };
      case 'sw/deep-disable':
        return { ok: true, data: await deps.deep.disable() };
      case 'sw/deep-exclude':
        return { ok: true, data: await deps.deep.exclude(message.domain) };
      case 'sw/deep-include':
        return { ok: true, data: await deps.deep.include(message.domain) };
      case 'sw/deep-clear':
        return { ok: true, data: await deps.deep.clear() };
      case 'sw/open-search':
        await deps.openSearch();
        return { ok: true, data: { opened: true } };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { code: error instanceof EngineError ? error.code : 'engine-unavailable', message } };
  }
}
