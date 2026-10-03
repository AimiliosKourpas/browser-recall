// Pure dispatch from a validated call to the store. The store is supplied lazily so `ping` never depends on the database.
import type { EngineCall, EngineInfo, EngineResults } from './contract';
import type { SearchStore } from './store';

export interface HandlerContext {
  info: EngineInfo;
  getStore: () => Promise<SearchStore>;
}

export async function handleCall<C extends EngineCall>(call: C, ctx: HandlerContext): Promise<EngineResults[C['method']]> {
  return (await dispatch(call, ctx)) as EngineResults[C['method']];
}

async function dispatch(call: EngineCall, ctx: HandlerContext): Promise<unknown> {
  if (call.method === 'ping') return ctx.info;
  const store = await ctx.getStore();
  switch (call.method) {
    case 'upsertHistory':
      return store.upsertHistory(call.params.rows);
    case 'upsertContent':
      return store.upsertContent(call.params);
    case 'savePage':
      return store.savePage(call.params);
    case 'addSnippet':
      return store.addSnippet(call.params);
    case 'search':
      return store.search(call.params);
    case 'suggest':
      return store.suggest(call.params.term, call.params.limit);
    case 'deleteUrls':
      return store.deleteUrls(call.params.urls);
    case 'deleteDomain':
      return store.deleteDomain(call.params.domain, call.params.includeSaved ?? false);
    case 'deleteRange':
      return store.deleteRange(call.params.start, call.params.end);
    case 'deleteAllExceptSaved':
      return store.deleteAllExceptSaved();
    case 'deleteEverything':
      return store.deleteEverything();
    case 'applyRetention':
      return store.applyRetention(call.params.months, call.params.now);
    case 'enforceCap':
      return store.enforceCap(call.params.maxBytes);
    case 'maintenance':
      return store.maintenance(call.params);
    case 'stats':
      return store.stats();
    case 'integrityCheck':
      return store.integrityCheck();
    case 'exportData':
      return store.exportData(call.params.scope, call.params.now);
    case 'importData':
      return store.importData(call.params.data);
  }
}
