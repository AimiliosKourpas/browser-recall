// Offscreen document lifecycle (ARCHITECTURE §9): existence check via runtime.getContexts (Chrome 116+), a promise lock so
// concurrent callers create it once, and tolerance of the "only one offscreen document" race. The service worker holds
// no durable state: losing this module's lock on termination is harmless because creation is re-checked every time.

export interface OffscreenApi {
  hasDocument(): Promise<boolean>;
  create(): Promise<void>;
  close(): Promise<void>;
}

export interface OffscreenManager {
  ensure(): Promise<void>;
  close(): Promise<void>;
}

const ALREADY_EXISTS = /single offscreen document|already exist/i;

export function createOffscreenManager(api: OffscreenApi): OffscreenManager {
  let creating: Promise<void> | undefined;
  return {
    async ensure() {
      if (await api.hasDocument()) return;
      creating ??= api
        .create()
        .catch(async (error: unknown) => {
          // Another SW instance (restarted mid-call) may have created it between our check and create().
          if (ALREADY_EXISTS.test(String(error)) && (await api.hasDocument())) return;
          throw error;
        })
        .finally(() => {
          creating = undefined;
        });
      await creating;
    },
    async close() {
      if (await api.hasDocument()) await api.close();
    },
  };
}

export const OFFSCREEN_PATH = 'offscreen.html';

export function createChromeOffscreenApi(chromeApi: typeof chrome = chrome): OffscreenApi {
  return {
    async hasDocument() {
      const contexts = await chromeApi.runtime.getContexts({ contextTypes: [chromeApi.runtime.ContextType.OFFSCREEN_DOCUMENT] });
      return contexts.length > 0;
    },
    create: () =>
      chromeApi.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chromeApi.offscreen.Reason.WORKERS],
        justification: 'Hosts the local search database worker (SQLite WASM + OPFS); service workers cannot create workers.',
      }),
    close: () => chromeApi.offscreen.closeDocument(),
  };
}
