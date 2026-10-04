// Request/response contract between the service worker, the offscreen host and the engine worker (pure: no chrome.*).
// `engineCallSchema` is validated at the service-worker gate AND at the worker boundary; EngineResults types every result.
import { z } from 'zod';
import {
  addSnippetSchema,
  contentSchema,
  exportDataSchema,
  historyRowSchema,
  LIMITS,
  savePageSchema,
  searchParamsSchema,
  type CapSummary,
  type DeleteSummary,
  type ExportData,
  type IntegrityReport,
  type MaintenanceSummary,
  type SearchResponse,
  type Stats,
  type UpsertSummary,
} from './model';
import type { EngineErrorCode } from './errors';

export const ENGINE_PROTOCOL_VERSION = 1;

export const engineInfoSchema = z.object({
  protocol: z.literal(ENGINE_PROTOCOL_VERSION),
  /** Changes every time the worker is (re)created: lets callers detect a restarted engine. */
  instanceId: z.string().min(1),
});
export type EngineInfo = z.infer<typeof engineInfoSchema>;

const params = <T extends z.ZodRawShape, M extends string>(method: M, shape: T) => z.object({ method: z.literal(method), params: z.object(shape) });
const url = z.string().max(LIMITS.url);

export const engineCallSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('ping') }),
  params('upsertHistory', { rows: z.array(historyRowSchema).max(LIMITS.batch) }),
  z.object({ method: z.literal('upsertContent'), params: contentSchema }),
  z.object({ method: z.literal('savePage'), params: savePageSchema }),
  z.object({ method: z.literal('addSnippet'), params: addSnippetSchema }),
  params('unsavePage', { url }),
  params('deleteSnippet', { id: z.number().int().nonnegative() }),
  z.object({ method: z.literal('search'), params: searchParamsSchema }),
  params('suggest', { term: z.string().max(100), limit: z.number().int().min(1).max(10).optional() }),
  params('lastVisits', { urls: z.array(url).max(LIMITS.batch) }),
  params('deleteUrls', { urls: z.array(url).max(LIMITS.batch) }),
  params('deleteDomain', { domain: z.string().max(255), includeSaved: z.boolean().optional() }),
  params('deleteRange', { start: z.number().finite(), end: z.number().finite() }),
  z.object({ method: z.literal('deleteAllExceptSaved') }),
  z.object({ method: z.literal('deleteEverything') }),
  params('applyRetention', { months: z.number().int().min(1).max(1200).nullable(), now: z.number().finite() }),
  params('enforceCap', { maxBytes: z.number().int().positive() }),
  params('maintenance', { vacuumPages: z.number().int().min(1).max(5000).optional(), minFreePages: z.number().int().min(0).optional(), ftsMerge: z.boolean().optional() }),
  z.object({ method: z.literal('stats') }),
  z.object({ method: z.literal('integrityCheck') }),
  params('exportData', { scope: z.enum(['saved', 'all']), now: z.number().finite() }),
  params('importData', { data: exportDataSchema }),
]);
export type EngineCall = z.infer<typeof engineCallSchema>;
export type EngineMethod = EngineCall['method'];
export type EngineCallOf<M extends EngineMethod> = Extract<EngineCall, { method: M }>;

export interface EngineResults {
  ping: EngineInfo;
  upsertHistory: UpsertSummary;
  upsertContent: { changed: boolean; skipped: boolean };
  savePage: { skipped: boolean };
  addSnippet: { id: number; truncated: boolean } | { skipped: true };
  unsavePage: { changed: boolean; removed: 'none' | 'page' | 'saved-flag' };
  deleteSnippet: { deleted: boolean };
  search: SearchResponse;
  suggest: string[];
  lastVisits: { url: string; lastVisit: number }[];
  deleteUrls: DeleteSummary;
  deleteDomain: DeleteSummary;
  deleteRange: DeleteSummary;
  deleteAllExceptSaved: DeleteSummary;
  deleteEverything: DeleteSummary;
  applyRetention: DeleteSummary;
  enforceCap: CapSummary;
  maintenance: MaintenanceSummary;
  stats: Stats;
  integrityCheck: IntegrityReport;
  exportData: ExportData;
  importData: { pages: number; snippets: number; skipped: number };
}

/** worker ← offscreen */
export const engineRequestSchema = z.object({ id: z.number().int().nonnegative(), call: engineCallSchema });
export type EngineRequest = z.infer<typeof engineRequestSchema>;

/** worker → offscreen */
export type EngineResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { code: EngineErrorCode; message: string } };

export const WORKER_READY = { ready: true } as const;
