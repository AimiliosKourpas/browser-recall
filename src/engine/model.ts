// Domain model and parameter schemas for the engine API (pure; no chrome.*). Schemas validate at the worker boundary AND
// at the service-worker gate; the TS types are derived from them so the two never drift.
import { z } from 'zod';
import type { Snippet } from './search/snippet';

export const LIMITS = {
  url: 4096,
  title: 2000,
  /** Per-page caps (ARCHITECTURE §6): the store re-applies them as a defence in depth. */
  body: 50_000,
  headings: 5_000,
  description: 1_000,
  /** Saved snippet quote cap (PRODUCT_SPEC §5.4, [TUNE] in M5). */
  snippet: 5_000,
  batch: 5_000,
  /** Ledger preview of stored text (characters) */
  preview: 600,
} as const;

const ms = z.number().finite().nonnegative();

export const historyRowSchema = z.object({
  url: z.string().max(LIMITS.url),
  title: z.string().max(LIMITS.title).optional(),
  lastVisitTime: ms,
  visitCount: z.number().int().nonnegative().optional(),
  typedCount: z.number().int().nonnegative().optional(),
});
export type HistoryRow = z.infer<typeof historyRowSchema>;

export const contentSchema = z.object({
  url: z.string().max(LIMITS.url),
  title: z.string().max(LIMITS.title).optional(),
  description: z.string().max(LIMITS.description * 20).optional(),
  headings: z.string().max(LIMITS.headings * 20).optional(),
  body: z.string().max(LIMITS.body * 20).optional(),
  lang: z.string().max(35).optional(),
  contentHash: z.string().max(128).optional(),
  indexedAt: ms,
});
export type ContentInput = z.infer<typeof contentSchema>;

export const savePageSchema = contentSchema.omit({ indexedAt: true }).extend({ savedAt: ms });
export type SavePageInput = z.infer<typeof savePageSchema>;

export const addSnippetSchema = z.object({
  url: z.string().max(LIMITS.url),
  pageTitle: z.string().max(LIMITS.title).optional(),
  text: z.string().min(1).max(LIMITS.snippet * 20),
  fragment: z.string().max(LIMITS.url).optional(),
  createdAt: ms,
});
export type AddSnippetInput = z.infer<typeof addSnippetSchema>;

export const searchParamsSchema = z.object({
  query: z.string().max(1000),
  limit: z.number().int().min(1).max(200).optional(),
  now: ms.optional(),
  tzOffsetMinutes: z.number().int().min(-14 * 60).max(14 * 60).optional(),
});
export type SearchParams = z.infer<typeof searchParamsSchema>;

export const exportDataSchema = z.object({
  format: z.literal('browser-recall-export'),
  version: z.literal(1),
  exportedAt: ms,
  scope: z.enum(['saved', 'all']),
  pages: z.array(
    z.object({
      url: z.string().max(LIMITS.url),
      title: z.string().max(LIMITS.title),
      firstSeen: ms,
      lastVisit: ms,
      visitCount: z.number().int().nonnegative(),
      typedCount: z.number().int().nonnegative(),
      lang: z.string().nullable(),
      flags: z.number().int().min(0).max(7),
      savedAt: ms.nullable(),
      contentHash: z.string().nullable(),
      contentIndexedAt: ms.nullable(),
      headings: z.string(),
      description: z.string(),
      body: z.string(),
    }),
  ),
  snippets: z.array(
    z.object({
      url: z.string().max(LIMITS.url),
      pageTitle: z.string(),
      text: z.string(),
      fragment: z.string().nullable(),
      truncated: z.boolean(),
      createdAt: ms,
    }),
  ),
});
export type ExportData = z.infer<typeof exportDataSchema>;

// ---- results ----
export type Source = 'saved' | 'snippet' | 'deep' | 'history';

export interface SearchResult {
  kind: 'page' | 'snippet';
  /** page id (kind page) or snippet id (kind snippet) */
  id: number;
  url: string;
  title: string;
  domain: string;
  /** highest tier: saved > snippet > deep > history */
  source: Source;
  flags: { history: boolean; content: boolean; saved: boolean };
  /** last visit (page) or creation time (snippet), epoch ms */
  timestamp: number;
  visitCount: number;
  score: number;
  /** true for results found by relaxation (any-term / substring), shown after exact matches */
  approximate: boolean;
  matchKind: 'content' | 'title-url' | 'filter';
  snippet?: Snippet;
  titleHighlights: [number, number][];
  /** text-fragment, for snippet results */
  fragment?: string;
}

export interface Suggestion {
  term: string;
  replacement: string;
}

export interface SearchResponse {
  /** time spent inside the engine for this search (ms); the UI may show it, tests use it to separate engine from messaging cost */
  tookMs: number;
  results: SearchResult[];
  suggestions: Suggestion[];
  /** the interpreted filters, for filter chips */
  filters: { sites: string[]; excludeSites: string[]; after?: number; before?: number; isSaved: boolean; isSnippet: boolean };
}

export interface UpsertSummary {
  inserted: number;
  updated: number;
  /** non-http(s) or malformed URLs (A6) */
  skipped: number;
}

export interface DeleteSummary {
  deletedPages: number;
  /** saved pages that were kept (only their history flag was cleared) */
  keptSaved: number;
}

/** Ledger (M8): one row per site; sizes are the stored original text. */
export interface DomainStat {
  domain: string;
  pages: number;
  saved: number;
  withContent: number;
  textBytes: number;
  lastActivity: number;
}

/** Ledger (M8): exactly what is stored for one page. `bodyPreview` is the first characters of the stored text, never more. */
export interface PageInfo {
  url: string;
  title: string;
  domain: string;
  flags: { history: boolean; content: boolean; saved: boolean };
  firstSeen: number;
  lastVisit: number;
  visitCount: number;
  savedAt: number | null;
  contentIndexedAt: number | null;
  textBytes: number;
  headings: string;
  description: string;
  bodyPreview: string;
  snippets: number;
}

export interface Stats {
  schemaVersion: number;
  pages: number;
  withHistory: number;
  withContent: number;
  saved: number;
  snippets: number;
  /** total size of stored page text (bytes) */
  textBytes: number;
  /** file size = page_count * page_size */
  dbBytes: number;
  /** excludes free pages: what the database would shrink to after vacuuming */
  liveBytes: number;
  freelistPages: number;
  autoVacuum: 'none' | 'full' | 'incremental';
}

export interface MaintenanceSummary {
  freelistBefore: number;
  freelistAfter: number;
  vacuumedPages: number;
  ftsMerged: boolean;
}

export interface IntegrityReport {
  ok: boolean;
  sqlite: string[];
  fts: { main: string; meta: string; snippets: string };
  consistency: { pages: number; ftsMainDocs: number; ftsMetaDocs: number; consistent: boolean };
}

export interface CapSummary {
  liveBytesBefore: number;
  liveBytesAfter: number;
  trimmedContent: number;
  deletedPages: number;
}
