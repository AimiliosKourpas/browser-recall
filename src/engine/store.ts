// SearchStore: the ONLY place SQL lives (blueprint ARCHITECTURE §5.4b). Single owner of the database: the engine worker.
// All user text is bound as parameters or reduced to folded alphanumeric tokens before it reaches an FTS5 MATCH string.
import type { Db, Statement } from './db';
import { fold, foldWithMap, tokenize } from './fold';
import {
  LIMITS,
  type AddSnippetInput,
  type CapSummary,
  type ContentInput,
  type DeleteSummary,
  type ExportData,
  type HistoryRow,
  type IntegrityReport,
  type MaintenanceSummary,
  type SavePageInput,
  type SearchParams,
  type SearchResponse,
  type SearchResult,
  type Source,
  type Stats,
  type Suggestion,
  type UpsertSummary,
} from './model';
import { LATEST_SCHEMA_VERSION, PAGE_FLAGS, migrate, readSchemaVersion, type Migration } from './schema';
import { editDistance } from './search/edit-distance';
import { buildAnyMatch, buildExcludeMatch, buildMatch, buildTrigramMatch } from './search/match';
import { parseQuery, type ParsedQuery } from './search/parser';
import { WEIGHTS, combine, normalizeBm25, recency, titleUrlHit, visitBoost } from './search/ranking';
import { buildSnippet, highlightRanges } from './search/snippet';
import { normalizeUrl } from './url';

const CANDIDATES = 200;
const PHRASE_RERANK = 50;
/** relaxed (approximate) results are a fallback: fewer candidates, and snippet work only for the best few */
const RELAXED_CANDIDATES = 40;
const RELAXED_SNIPPETS = 10;
const RELAX_BELOW = 5;
const BM25 = 'bm25(fts_main, 10.0, 4.0, 3.0, 1.0)';
const DAY = 86_400_000;
const CHUNK = 400;

const chunks = <T>(xs: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');
const encoder = new TextEncoder();
/** UTF-8 size: what the text actually costs on disk (Greek is 2 bytes per letter), unlike String.length. */
const utf8Bytes = (s: string): number => encoder.encode(s).length;
/** true if the tokens occur consecutively (any non-alphanumeric separators) in already-folded text: one native regex scan */
const adjacent = (tokens: string[], foldedText: string): boolean => new RegExp(tokens.join('[^\\p{L}\\p{N}]+'), 'u').test(foldedText);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const clip = (s: string | undefined, n: number) => (s ?? '').slice(0, n);

interface PageRow {
  id: number;
  url: string;
  title: string;
  domain: string;
  lastVisit: number;
  visitCount: number;
  flags: number;
  bm25: number;
}

const sourceOf = (flags: number, kind: 'page' | 'snippet'): Source => (kind === 'snippet' ? 'snippet' : flags & PAGE_FLAGS.saved ? 'saved' : flags & PAGE_FLAGS.content ? 'deep' : 'history');

export class SearchStore {
  /** Prepared statements for the hot write path (compiling FTS5 statements per row was ~3× slower). Bounded; finalised on close. */
  private readonly prepared = new Map<string, Statement>();

  private constructor(private readonly db: Db) {}

  private statement(sql: string): Statement {
    let st = this.prepared.get(sql);
    if (!st) {
      if (this.prepared.size >= 100) this.finalizeStatements(); // IN (...) lists of varying arity would otherwise grow it without bound
      st = this.db.prepare(sql);
      this.prepared.set(sql, st);
    }
    return st;
  }

  private finalizeStatements(): void {
    for (const st of this.prepared.values()) st.finalize();
    this.prepared.clear();
  }

  private run(o: { sql: string; bind?: unknown[] }): void {
    const st = this.statement(o.sql);
    try {
      st.bind(o.bind ?? []);
      st.step();
    } finally {
      st.reset();
    }
  }

  /** First row of a (cached) query, or undefined. */
  private first(sql: string, bind: unknown[]): unknown[] | undefined {
    const st = this.statement(sql);
    try {
      st.bind(bind);
      if (!st.step()) return undefined;
      return Array.from({ length: st.columnCount }, (_, i) => st.get(i));
    } finally {
      st.reset();
    }
  }

  /** Creates/upgrades the schema, then returns a store. Throws DatabaseTooNewError for a newer database. */
  static open(db: Db, migrations?: Migration[]): SearchStore {
    migrate(db, migrations);
    return new SearchStore(db);
  }

  // ------------------------------------------------------------------ writes

  /** Upsert Chrome-history rows (History tier). Non-http(s) URLs are skipped (A6). Idempotent. */
  upsertHistory(rows: HistoryRow[]): UpsertSummary {
    const summary: UpsertSummary = { inserted: 0, updated: 0, skipped: 0 };
    this.db.transaction(() => {
      for (const row of rows.slice(0, LIMITS.batch)) {
        const norm = normalizeUrl(row.url);
        if (!norm) {
          summary.skipped++;
          continue;
        }
        const last = Math.round(row.lastVisitTime);
        const title = clip(row.title, LIMITS.title);
        const existing = this.first('SELECT id, title, last_visit FROM pages WHERE url = ?', [norm.url]);
        if (!existing) {
          this.run({
            sql: 'INSERT INTO pages(url, domain, title, first_seen, last_visit, visit_count, typed_count, flags) VALUES(?,?,?,?,?,?,?,?)',
            bind: [norm.url, norm.domain, title, last, last, row.visitCount ?? 1, row.typedCount ?? 0, PAGE_FLAGS.history],
          });
          this.reindex(Number(this.db.selectValue('SELECT last_insert_rowid()')));
          summary.inserted++;
        } else {
          const id = Number(existing[0]);
          const titleChanged = title !== '' && title !== existing[1];
          this.run({
            sql: 'UPDATE pages SET title = ?, last_visit = max(last_visit, ?), visit_count = ?, typed_count = ?, flags = flags | ? WHERE id = ?',
            bind: [titleChanged ? title : String(existing[1]), last, row.visitCount ?? 1, row.typedCount ?? 0, PAGE_FLAGS.history, id],
          });
          if (titleChanged) this.reindex(id);
          summary.updated++;
        }
      }
    });
    return summary;
  }

  /**
   * Store page text (Deep Search). Creates the page if needed. Returns changed:false when the content hash is unchanged.
   * Caps are re-applied here (defence in depth); the extractor applies them first.
   */
  upsertContent(input: ContentInput): { changed: boolean; skipped: boolean } {
    const norm = normalizeUrl(input.url);
    if (!norm) return { changed: false, skipped: true };
    let changed = false;
    this.db.transaction(() => {
      const id = this.ensurePage(norm.url, norm.domain, input.title, input.indexedAt);
      const prior = this.first('SELECT content_hash, flags FROM pages WHERE id = ?', [id]) as [string | null, number];
      if (input.contentHash && prior[0] === input.contentHash && prior[1] & PAGE_FLAGS.content) return;
      changed = true;
      this.writeContents(id, input);
      this.run({
        sql: 'UPDATE pages SET flags = flags | ?, lang = ?, content_hash = ?, content_indexed_at = ?, title = CASE WHEN ? != \'\' THEN ? ELSE title END WHERE id = ?',
        bind: [PAGE_FLAGS.content, input.lang ?? null, input.contentHash ?? null, Math.round(input.indexedAt), clip(input.title, LIMITS.title), clip(input.title, LIMITS.title), id],
      });
      this.reindex(id);
    });
    return { changed, skipped: false };
  }

  /** "Remember": marks the page saved and stores its text (title-only is fine for restricted pages). Never trimmed by retention/mirroring. */
  savePage(input: SavePageInput): { skipped: boolean } {
    const norm = normalizeUrl(input.url);
    if (!norm) return { skipped: true };
    this.db.transaction(() => {
      const id = this.ensurePage(norm.url, norm.domain, input.title, input.savedAt);
      this.writeContents(id, input);
      this.run({
        sql: 'UPDATE pages SET flags = flags | ?, saved_at = ?, lang = coalesce(?, lang), content_hash = ?, content_indexed_at = ?, title = CASE WHEN ? != \'\' THEN ? ELSE title END WHERE id = ?',
        bind: [PAGE_FLAGS.saved | PAGE_FLAGS.content, Math.round(input.savedAt), input.lang ?? null, input.contentHash ?? null, Math.round(input.savedAt), clip(input.title, LIMITS.title), clip(input.title, LIMITS.title), id],
      });
      this.reindex(id);
    });
    return { skipped: false };
  }

  /**
   * "Remove from saved": clears the saved flag. A page still in Chrome history keeps its history row (title/URL searchable) but
   * loses the text that was stored for the saved item; a page that only existed because it was saved is deleted. Snippets are
   * separate saved items and are not touched here.
   */
  unsavePage(url: string): { changed: boolean; removed: 'none' | 'page' | 'saved-flag' } {
    const norm = normalizeUrl(url);
    const row = norm ? this.first('SELECT id, flags FROM pages WHERE url = ?', [norm.url]) : undefined;
    if (!row || !(Number(row[1]) & PAGE_FLAGS.saved)) return { changed: false, removed: 'none' };
    const id = Number(row[0]);
    let removed: 'page' | 'saved-flag' = 'saved-flag';
    this.db.transaction(() => {
      if (Number(row[1]) & PAGE_FLAGS.history) {
        this.run({ sql: 'DELETE FROM contents WHERE page_id = ?', bind: [id] });
        this.run({ sql: `UPDATE pages SET flags = flags & ${~(PAGE_FLAGS.saved | PAGE_FLAGS.content) & 7}, saved_at = NULL, content_hash = NULL, content_indexed_at = NULL WHERE id = ?`, bind: [id] });
        this.reindex(id);
      } else {
        this.removePages([id]);
        removed = 'page';
      }
    });
    return { changed: true, removed };
  }

  deleteSnippet(id: number): { deleted: boolean } {
    const exists = this.first('SELECT 1 FROM snippets WHERE id = ?', [id]);
    if (!exists) return { deleted: false };
    this.db.transaction(() => {
      this.run({ sql: 'DELETE FROM fts_snip WHERE rowid = ?', bind: [id] });
      this.run({ sql: 'DELETE FROM snippets WHERE id = ?', bind: [id] });
    });
    return { deleted: true };
  }

  /** Saved quote. Never expires and survives page deletion. Over-long text is truncated and flagged. */
  addSnippet(input: AddSnippetInput): { id: number; truncated: boolean } | { skipped: true } {
    const norm = normalizeUrl(input.url);
    if (!norm) return { skipped: true };
    const truncated = input.text.length > LIMITS.snippet;
    const text = input.text.slice(0, LIMITS.snippet);
    const title = clip(input.pageTitle, LIMITS.title);
    let id = 0;
    this.db.transaction(() => {
      this.run({
        sql: 'INSERT INTO snippets(url, domain, page_title, text, fragment, truncated, created_at) VALUES(?,?,?,?,?,?,?)',
        bind: [norm.url, norm.domain, title, text, input.fragment ?? null, truncated ? 1 : 0, Math.round(input.createdAt)],
      });
      id = Number(this.db.selectValue('SELECT last_insert_rowid()'));
      this.run({ sql: 'INSERT INTO fts_snip(rowid, text, page_title) VALUES(?,?,?)', bind: [id, fold(text), fold(title)] });
    });
    return { id, truncated };
  }

  private ensurePage(url: string, domain: string, title: string | undefined, at: number): number {
    const found = this.first('SELECT id FROM pages WHERE url = ?', [url]);
    if (found) return Number(found[0]);
    const t = Math.round(at);
    this.run({ sql: 'INSERT INTO pages(url, domain, title, first_seen, last_visit, visit_count, flags) VALUES(?,?,?,?,?,0,0)', bind: [url, domain, clip(title, LIMITS.title), t, t] });
    return Number(this.db.selectValue('SELECT last_insert_rowid()'));
  }

  private writeContents(id: number, input: Pick<ContentInput, 'headings' | 'description' | 'body'>): void {
    const headings = clip(input.headings, LIMITS.headings);
    const description = clip(input.description, LIMITS.description);
    const body = clip(input.body, LIMITS.body);
    const bytes = utf8Bytes(headings) + utf8Bytes(description) + utf8Bytes(body);
    this.run({
      sql: 'INSERT INTO contents(page_id, headings, description, body, bytes) VALUES(?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET headings=excluded.headings, description=excluded.description, body=excluded.body, bytes=excluded.bytes',
      bind: [id, headings, description, body, bytes],
    });
  }

  /** Rebuilds the folded FTS rows of one page from the stored originals. Must run inside the caller's transaction. */
  private reindex(id: number): void {
    const page = this.first('SELECT title, url FROM pages WHERE id = ?', [id]);
    if (!page) return;
    const content = this.first('SELECT headings, description, body FROM contents WHERE page_id = ?', [id]) ?? ['', '', ''];
    this.run({ sql: 'DELETE FROM fts_main WHERE rowid = ?', bind: [id] });
    this.run({ sql: 'DELETE FROM fts_meta WHERE rowid = ?', bind: [id] });
    this.run({
      sql: 'INSERT INTO fts_main(rowid, title, headings, description, body) VALUES(?,?,?,?,?)',
      bind: [id, fold(String(page[0])), fold(String(content[0])), fold(String(content[1])), fold(String(content[2]))],
    });
    this.run({ sql: 'INSERT INTO fts_meta(rowid, title, url) VALUES(?,?,?)', bind: [id, fold(String(page[0])), fold(String(page[1]))] });
  }

  // ------------------------------------------------------------------ deletes

  /**
   * Stored last-visit time per URL (normalised). Used by the history layer's expiry guard (ADR-006): Chrome's own 90-day
   * expiry fires the same onVisitRemoved event as a user deletion, and only the stored last visit tells them apart.
   * Unknown URLs are simply absent from the result.
   */
  lastVisits(urls: string[]): { url: string; lastVisit: number }[] {
    const normalized = [...new Set(urls.map((u) => normalizeUrl(u)?.url).filter((u): u is string => !!u))];
    const out: { url: string; lastVisit: number }[] = [];
    for (const part of chunks(normalized)) {
      for (const r of this.db.selectArrays(`SELECT url, last_visit FROM pages WHERE url IN (${marks(part.length)})`, part)) out.push({ url: String(r[0]), lastVisit: Number(r[1]) });
    }
    return out;
  }

  /** Mirrored deletion by exact (normalised) URL. Saved pages keep their data; only the history flag is cleared. */
  deleteUrls(urls: string[]): DeleteSummary {
    const normalized = [...new Set(urls.map((u) => normalizeUrl(u)?.url).filter((u): u is string => !!u))];
    const ids: number[] = [];
    for (const part of chunks(normalized)) ids.push(...this.db.selectArrays(`SELECT id FROM pages WHERE url IN (${marks(part.length)})`, part).map((r) => Number(r[0])));
    return this.removeOrDemote(ids);
  }

  /** Delete a site (the domain and its subdomains). `includeSaved` also removes saved pages and their snippets. */
  deleteDomain(domain: string, includeSaved = false): DeleteSummary {
    const d = fold(domain).replace(/^www\./, '');
    const ids = this.db.selectArrays("SELECT id FROM pages WHERE domain = ? OR domain LIKE ? ESCAPE '\\'", [d, `%.${escapeLike(d)}`]).map((r) => Number(r[0]));
    const summary = includeSaved ? this.removeAll(ids) : this.removeOrDemote(ids);
    if (includeSaved) this.deleteSnippetsWhere("domain = ? OR domain LIKE ? ESCAPE '\\'", [d, `%.${escapeLike(d)}`]);
    return summary;
  }

  /** Delete pages whose last visit is in [start, end). Saved pages are kept. */
  deleteRange(start: number, end: number): DeleteSummary {
    const ids = this.db.selectArrays('SELECT id FROM pages WHERE last_visit >= ? AND last_visit < ?', [start, end]).map((r) => Number(r[0]));
    return this.removeOrDemote(ids);
  }

  /** "Clear browsing data → all history": everything except saved pages and snippets. */
  deleteAllExceptSaved(): DeleteSummary {
    const ids = this.db.selectArrays('SELECT id FROM pages').map((r) => Number(r[0]));
    return this.removeOrDemote(ids);
  }

  /** "Delete everything" (type-to-confirm in the UI): all pages including saved ones, and all snippets. */
  deleteEverything(): DeleteSummary {
    const ids = this.db.selectArrays('SELECT id FROM pages').map((r) => Number(r[0]));
    const summary = this.removeAll(ids);
    this.deleteSnippetsWhere('1 = 1', []);
    return summary;
  }

  /** Retention sweep: removes non-saved pages last visited before now - months. `months: null` keeps everything. */
  applyRetention(months: number | null, now: number): DeleteSummary {
    if (months === null) return { deletedPages: 0, keptSaved: 0 };
    return this.deleteRange(0, now - months * 30 * DAY);
  }

  private removeOrDemote(ids: number[]): DeleteSummary {
    let deleted = 0;
    let kept = 0;
    this.db.transaction(() => {
      for (const part of chunks(ids)) {
        const saved = this.db.selectArrays(`SELECT id FROM pages WHERE id IN (${marks(part.length)}) AND (flags & ${PAGE_FLAGS.saved}) != 0`, part).map((r) => Number(r[0]));
        const savedSet = new Set(saved);
        const doomed = part.filter((id) => !savedSet.has(id));
        if (saved.length) this.run({ sql: `UPDATE pages SET flags = flags & ${~PAGE_FLAGS.history & 7} WHERE id IN (${marks(saved.length)})`, bind: saved });
        kept += saved.length;
        deleted += this.removePages(doomed);
      }
    });
    return { deletedPages: deleted, keptSaved: kept };
  }

  private removeAll(ids: number[]): DeleteSummary {
    let deleted = 0;
    this.db.transaction(() => {
      for (const part of chunks(ids)) deleted += this.removePages(part);
    });
    return { deletedPages: deleted, keptSaved: 0 };
  }

  private removePages(ids: number[]): number {
    if (ids.length === 0) return 0;
    for (const table of ['fts_main', 'fts_meta']) this.run({ sql: `DELETE FROM ${table} WHERE rowid IN (${marks(ids.length)})`, bind: ids });
    this.run({ sql: `DELETE FROM contents WHERE page_id IN (${marks(ids.length)})`, bind: ids });
    this.run({ sql: `DELETE FROM pages WHERE id IN (${marks(ids.length)})`, bind: ids });
    return ids.length;
  }

  private deleteSnippetsWhere(clause: string, bind: unknown[]): void {
    this.db.transaction(() => {
      const ids = this.db.selectArrays(`SELECT id FROM snippets WHERE ${clause}`, bind).map((r) => Number(r[0]));
      for (const part of chunks(ids)) {
        this.run({ sql: `DELETE FROM fts_snip WHERE rowid IN (${marks(part.length)})`, bind: part });
        this.run({ sql: `DELETE FROM snippets WHERE id IN (${marks(part.length)})`, bind: part });
      }
    });
  }

  // ------------------------------------------------------------------ search

  search(params: SearchParams): SearchResponse {
    const started = performance.now();
    const response = this.searchInner(params);
    return { ...response, tookMs: Math.round((performance.now() - started) * 10) / 10 };
  }

  private searchInner(params: SearchParams): Omit<SearchResponse, 'tookMs'> {
    const now = params.now ?? Date.now();
    const q = parseQuery(params.query, { now, tzOffsetMinutes: params.tzOffsetMinutes ?? 0 });
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));
    const filters = { sites: q.sites, excludeSites: q.excludeSites, ...(q.after !== undefined ? { after: q.after } : {}), ...(q.before !== undefined ? { before: q.before } : {}), isSaved: q.isSaved, isSnippet: q.isSnippet };
    const hasCriteria = q.positives.length > 0 || q.sites.length > 0 || q.excludeSites.length > 0 || q.after !== undefined || q.before !== undefined || q.isSaved || q.isSnippet;
    if (!hasCriteria) return { results: [], suggestions: [], filters };

    const terms = q.positives.flatMap((p) => p.tokens);
    const lastPositive = q.positives[q.positives.length - 1];
    const prefixIndex = lastPositive && !lastPositive.quoted ? terms.length - 1 : -1;
    const includePages = !q.isSnippet || q.isSaved;
    const includeSnippets = q.isSnippet || !q.isSaved;

    const ctx = { q, terms, prefixIndex, now };
    let results: SearchResult[] = [];
    if (includePages) results.push(...this.searchPages(ctx, buildMatch(q.positives), false));
    if (includeSnippets) results.push(...this.searchSnippets(ctx));
    results = this.order(results);

    let suggestions: Suggestion[] = [];
    if (q.positives.length > 0 && results.length < RELAX_BELOW) {
      const have = new Set(results.map((r) => `${r.kind}:${r.id}`));
      const extra: SearchResult[] = [];
      if (includePages) {
        const any = buildAnyMatch(q.positives);
        if (any) extra.push(...this.searchPages(ctx, any, true));
        if (results.length + extra.length < RELAX_BELOW) extra.push(...this.searchTrigram(ctx));
      }
      const fresh = this.order(extra.filter((r, i, all) => !have.has(`${r.kind}:${r.id}`) && all.findIndex((x) => x.id === r.id && x.kind === r.kind) === i));
      results = [...results, ...fresh];
      suggestions = this.suggestFor(q);
    }
    return { results: results.slice(0, limit), suggestions, filters };
  }

  private order(results: SearchResult[]): SearchResult[] {
    // exact matches first, then relaxed ones; inside each group by score, then recency, then URL (deterministic)
    return results.sort((a, b) => Number(a.approximate) - Number(b.approximate) || b.score - a.score || b.timestamp - a.timestamp || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0) || a.id - b.id);
  }

  private pageFilters(q: ParsedQuery): { where: string[]; bind: unknown[] } {
    const where: string[] = [];
    const bind: unknown[] = [];
    const siteClause = (n: number) => `(${Array.from({ length: n }, () => "p.domain = ? OR p.domain LIKE ? ESCAPE '\\'").join(' OR ')})`;
    if (q.sites.length) {
      where.push(siteClause(q.sites.length));
      for (const d of q.sites) bind.push(d, `%.${escapeLike(d)}`);
    }
    if (q.excludeSites.length) {
      where.push(`NOT ${siteClause(q.excludeSites.length)}`);
      for (const d of q.excludeSites) bind.push(d, `%.${escapeLike(d)}`);
    }
    if (q.after !== undefined) {
      where.push('p.last_visit >= ?');
      bind.push(q.after);
    }
    if (q.before !== undefined) {
      where.push('p.last_visit < ?');
      bind.push(q.before);
    }
    if (q.isSaved) where.push(`(p.flags & ${PAGE_FLAGS.saved}) != 0`);
    const exclude = buildExcludeMatch(q.excludes);
    if (exclude) {
      where.push('p.id NOT IN (SELECT rowid FROM fts_main WHERE fts_main MATCH ?)');
      bind.push(exclude);
    }
    return { where, bind };
  }

  private rows(sql: string, bind: unknown[]): PageRow[] {
    return this.db.selectArrays(sql, bind).map((r) => ({ id: Number(r[0]), url: String(r[1]), title: String(r[2]), domain: String(r[3]), lastVisit: Number(r[4]), visitCount: Number(r[5]), flags: Number(r[6]), bm25: Number(r[7]) }));
  }

  private searchPages(ctx: SearchContext, match: string | undefined, approximate: boolean): SearchResult[] {
    const candidates = approximate ? RELAXED_CANDIDATES : CANDIDATES;
    const { q, terms, prefixIndex, now } = ctx;
    if (q.positives.length > 0 && !match) return [];
    const { where, bind } = this.pageFilters(q);
    const cols = 'p.id, p.url, p.title, p.domain, p.last_visit, p.visit_count, p.flags';
    let rows: PageRow[];
    if (match) {
      rows = this.rows(
        `SELECT ${cols}, ${BM25} AS s FROM fts_main JOIN pages p ON p.id = fts_main.rowid WHERE fts_main MATCH ?${where.length ? ` AND ${where.join(' AND ')}` : ''} ORDER BY s, p.last_visit DESC, p.id LIMIT ${candidates}`,
        [match, ...bind],
      );
    } else {
      rows = this.rows(`SELECT ${cols}, 0 AS s FROM pages p${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.last_visit DESC, p.id LIMIT ${candidates}`, bind);
    }
    return this.rank(rows, ctx, approximate, !!match, terms, prefixIndex, now);
  }

  private rank(rows: PageRow[], ctx: SearchContext, approximate: boolean, hasMatch: boolean, terms: string[], prefixIndex: number, now: number): SearchResult[] {
    const norm = hasMatch ? normalizeBm25(rows.map((r) => r.bm25)) : rows.map(() => 0);
    const pre = rows.map((r, i) => {
      const foldedTitle = fold(r.title);
      const score = combine({
        bm25Norm: norm[i] as number,
        titleUrl: titleUrlHit(terms, tokenize(foldedTitle), tokenize(r.url.toLowerCase())),
        recency: recency(r.lastVisit, now),
        visits: visitBoost(r.visitCount),
        saved: (r.flags & PAGE_FLAGS.saved) !== 0,
        phrase: 0,
      });
      return { r, score, foldedTitle };
    });
    pre.sort((a, b) => b.score - a.score || b.r.lastVisit - a.r.lastVisit || (a.r.url < b.r.url ? -1 : 1));
    return pre.map(({ r, score, foldedTitle }, index): SearchResult => {
      let snippet: SearchResult['snippet'];
      let phrase = 0;
      let matchKind: SearchResult['matchKind'] = hasMatch ? 'title-url' : 'filter';
      if (hasMatch && index < (approximate ? RELAXED_SNIPPETS : PHRASE_RERANK)) {
        const c = this.first('SELECT headings, description, body FROM contents WHERE page_id = ?', [r.id]);
        if (c) {
          for (const text of [String(c[2]), String(c[1]), String(c[0])]) {
            if (!text) continue;
            const folded = foldWithMap(text); // folded once: used for the snippet window AND the adjacency check below
            snippet = buildSnippet(text, terms, prefixIndex, {}, folded);
            if (text === c[2] && terms.length > 1) phrase = adjacent(terms, folded.text.slice(0, 20_000)) || adjacent(terms, foldedTitle) ? 1 : 0;
            if (snippet) break;
          }
          if (snippet) matchKind = 'content';
        }
      }
      const final = score + WEIGHTS.phrase * phrase;
      return {
        kind: 'page',
        id: r.id,
        url: r.url,
        title: r.title,
        domain: r.domain,
        source: sourceOf(r.flags, 'page'),
        flags: { history: !!(r.flags & PAGE_FLAGS.history), content: !!(r.flags & PAGE_FLAGS.content), saved: !!(r.flags & PAGE_FLAGS.saved) },
        timestamp: r.lastVisit,
        visitCount: r.visitCount,
        score: approximate ? final * 0.5 : final,
        approximate,
        matchKind,
        ...(snippet ? { snippet } : {}),
        titleHighlights: hasMatch ? highlightRanges(r.title, terms, prefixIndex) : [],
      };
    });
  }

  private searchTrigram(ctx: SearchContext): SearchResult[] {
    const { q, terms, prefixIndex, now } = ctx;
    const probe = buildTrigramMatch(fold(q.positives.map((p) => p.tokens.join(' ')).join(' ')));
    if (!probe) return [];
    const { where, bind } = this.pageFilters(q);
    const rows = this.rows(
      `SELECT p.id, p.url, p.title, p.domain, p.last_visit, p.visit_count, p.flags, 0 AS s FROM fts_meta JOIN pages p ON p.id = fts_meta.rowid WHERE fts_meta MATCH ?${where.length ? ` AND ${where.join(' AND ')}` : ''} ORDER BY p.last_visit DESC, p.id LIMIT 20`,
      [probe, ...bind],
    );
    return this.rank(rows, ctx, true, true, terms, prefixIndex, now);
  }

  private searchSnippets(ctx: SearchContext): SearchResult[] {
    const { q, terms, prefixIndex, now } = ctx;
    const match = buildMatch(q.positives);
    if (q.positives.length > 0 && !match) return [];
    const where: string[] = [];
    const bind: unknown[] = [];
    const site = () => "(s.domain = ? OR s.domain LIKE ? ESCAPE '\\')";
    if (q.sites.length) {
      where.push(`(${q.sites.map(site).join(' OR ')})`);
      for (const d of q.sites) bind.push(d, `%.${escapeLike(d)}`);
    }
    if (q.excludeSites.length) {
      where.push(`NOT (${q.excludeSites.map(site).join(' OR ')})`);
      for (const d of q.excludeSites) bind.push(d, `%.${escapeLike(d)}`);
    }
    if (q.after !== undefined) {
      where.push('s.created_at >= ?');
      bind.push(q.after);
    }
    if (q.before !== undefined) {
      where.push('s.created_at < ?');
      bind.push(q.before);
    }
    const exclude = buildExcludeMatch(q.excludes);
    if (exclude) {
      where.push('s.id NOT IN (SELECT rowid FROM fts_snip WHERE fts_snip MATCH ?)');
      bind.push(exclude);
    }
    const cols = 's.id, s.url, s.page_title, s.domain, s.created_at, s.text, s.fragment';
    const raw = match
      ? this.db.selectArrays(`SELECT ${cols}, bm25(fts_snip, 5.0, 2.0) AS b FROM fts_snip JOIN snippets s ON s.id = fts_snip.rowid WHERE fts_snip MATCH ?${where.length ? ` AND ${where.join(' AND ')}` : ''} ORDER BY b, s.created_at DESC, s.id LIMIT ${CANDIDATES}`, [match, ...bind])
      : this.db.selectArrays(`SELECT ${cols}, 0 AS b FROM snippets s${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC, s.id LIMIT ${CANDIDATES}`, bind);
    const norm = match ? normalizeBm25(raw.map((r) => Number(r[7]))) : raw.map(() => 0);
    return raw.map((r, i): SearchResult => {
      const text = String(r[5]);
      const title = String(r[2]);
      const snippet = match ? buildSnippet(text, terms, prefixIndex, { maxLength: 400 }) : undefined;
      return {
        kind: 'snippet',
        id: Number(r[0]),
        url: String(r[1]),
        title,
        domain: String(r[3]),
        source: 'snippet',
        flags: { history: false, content: false, saved: true },
        timestamp: Number(r[4]),
        visitCount: 0,
        score: combine({ bm25Norm: norm[i] as number, titleUrl: titleUrlHit(terms, tokenize(fold(title)), tokenize(fold(String(r[1])))), recency: recency(Number(r[4]), now), visits: 0, saved: true, phrase: 0 }),
        approximate: false,
        matchKind: match ? 'content' : 'filter',
        snippet: snippet ?? { text: text.slice(0, 400), highlights: [] },
        titleHighlights: match ? highlightRanges(title, terms, prefixIndex) : [],
        ...(r[6] ? { fragment: String(r[6]) } : {}),
      };
    });
  }

  // ------------------------------------------------------------------ suggestions

  /** "Did you mean": for each single, unquoted query word absent from the index, the closest indexed words (edit distance <= 2). */
  private suggestFor(q: ParsedQuery): Suggestion[] {
    const out: Suggestion[] = [];
    const last = q.positives[q.positives.length - 1];
    for (const p of q.positives) {
      if (p.quoted || p.tokens.length !== 1) continue;
      const term = p.tokens[0] as string;
      if ([...term].length < 4) continue;
      // the last word is matched as a PREFIX while typing: a prefix of an indexed word is not a misspelling
      const best = this.suggest(term, 1, p === last)[0];
      if (best) out.push({ term, replacement: best });
    }
    return out;
  }

  /** Closest indexed words to `term`; none when the term (or, with `asPrefix`, any word starting with it) already exists. */
  suggest(term: string, limit = 3, asPrefix = false): string[] {
    const t = fold(term);
    const known = asPrefix
      ? this.first('SELECT 1 FROM fts_vocab WHERE term >= ? AND term < ? LIMIT 1', [t, `${t}\uffff`])
      : this.first('SELECT 1 FROM fts_vocab WHERE term = ?', [t]);
    if (known) return [];
    const first = [...t][0];
    if (!first) return [];
    const candidates = this.db
      .selectArrays('SELECT term, doc FROM fts_vocab WHERE term >= ? AND term < ? AND length(term) BETWEEN ? AND ? ORDER BY doc DESC LIMIT 3000', [first, `${first}￿`, t.length - 2, t.length + 2])
      .map((r) => ({ term: String(r[0]), doc: Number(r[1]) }));
    return candidates
      .map((c) => ({ ...c, d: editDistance(t, c.term, 2) }))
      .filter((c) => c.d <= 2)
      .sort((a, b) => a.d - b.d || b.doc - a.doc || (a.term < b.term ? -1 : 1))
      .slice(0, limit)
      .map((c) => c.term);
  }

  // ------------------------------------------------------------------ maintenance, health, size

  stats(): Stats {
    const n = (sql: string) => Number(this.db.selectValue(sql) ?? 0);
    const pageCount = n('PRAGMA page_count');
    const pageSize = n('PRAGMA page_size');
    const freelist = n('PRAGMA freelist_count');
    const av = n('PRAGMA auto_vacuum');
    return {
      schemaVersion: readSchemaVersion(this.db),
      pages: n('SELECT count(*) FROM pages'),
      withHistory: n(`SELECT count(*) FROM pages WHERE (flags & ${PAGE_FLAGS.history}) != 0`),
      withContent: n(`SELECT count(*) FROM pages WHERE (flags & ${PAGE_FLAGS.content}) != 0`),
      saved: n(`SELECT count(*) FROM pages WHERE (flags & ${PAGE_FLAGS.saved}) != 0`),
      snippets: n('SELECT count(*) FROM snippets'),
      textBytes: n('SELECT coalesce(sum(bytes), 0) FROM contents'),
      dbBytes: pageCount * pageSize,
      liveBytes: (pageCount - freelist) * pageSize,
      freelistPages: freelist,
      autoVacuum: av === 2 ? 'incremental' : av === 1 ? 'full' : 'none',
    };
  }

  /**
   * Bounded maintenance (A7): reclaims at most `vacuumPages` free pages with incremental_vacuum, and only when the free list is
   * worth it (>= `minFreePages`). Optionally runs one bounded FTS5 merge step. Cheap enough for a daily alarm, never per write.
   */
  maintenance(opts: { vacuumPages?: number; minFreePages?: number; ftsMerge?: boolean } = {}): MaintenanceSummary {
    const vacuumPages = Math.max(1, Math.min(opts.vacuumPages ?? 500, 5000));
    const minFree = opts.minFreePages ?? 64;
    const before = Number(this.db.selectValue('PRAGMA freelist_count'));
    const incremental = Number(this.db.selectValue('PRAGMA auto_vacuum')) === 2;
    let vacuumed = 0;
    if (incremental && before >= minFree) {
      // each step of the pragma frees ONE page: it must be stepped to completion (db.exec stops after the first row)
      const stmt = this.db.prepare(`PRAGMA incremental_vacuum(${vacuumPages})`);
      try {
        while (stmt.step()) continue;
      } finally {
        stmt.finalize();
      }
      vacuumed = before - Number(this.db.selectValue('PRAGMA freelist_count'));
    }
    let merged = false;
    if (opts.ftsMerge) {
      for (const t of ['fts_main', 'fts_snip']) this.db.exec(`INSERT INTO ${t}(${t}, rank) VALUES('merge', 250)`);
      merged = true;
    }
    return { freelistBefore: before, freelistAfter: Number(this.db.selectValue('PRAGMA freelist_count')), vacuumedPages: vacuumed, ftsMerged: merged };
  }

  /**
   * Storage cap (PRODUCT_SPEC §5.6): while live size exceeds `maxBytes`, first drop Deep Search text of the oldest non-saved
   * pages (title/URL stay searchable), then delete the oldest non-saved pages. Bounded: at most 50 batches of 200 per phase.
   */
  enforceCap(maxBytes: number): CapSummary {
    const live = () => this.stats().liveBytes;
    const before = live();
    const out: CapSummary = { liveBytesBefore: before, liveBytesAfter: before, trimmedContent: 0, deletedPages: 0 };
    const notSaved = `(flags & ${PAGE_FLAGS.saved}) = 0`;
    for (let i = 0; i < 50 && live() > maxBytes; i++) {
      const ids = this.db.selectArrays(`SELECT id FROM pages WHERE (flags & ${PAGE_FLAGS.content}) != 0 AND ${notSaved} ORDER BY last_visit ASC, id LIMIT 200`).map((r) => Number(r[0]));
      if (ids.length === 0) break;
      this.db.transaction(() => {
        this.run({ sql: `DELETE FROM contents WHERE page_id IN (${marks(ids.length)})`, bind: ids });
        this.run({ sql: `UPDATE pages SET flags = flags & ${~PAGE_FLAGS.content & 7}, content_hash = NULL WHERE id IN (${marks(ids.length)})`, bind: ids });
        for (const id of ids) this.reindex(id);
      });
      out.trimmedContent += ids.length;
    }
    for (let i = 0; i < 50 && live() > maxBytes; i++) {
      const ids = this.db.selectArrays(`SELECT id FROM pages WHERE ${notSaved} ORDER BY last_visit ASC, id LIMIT 200`).map((r) => Number(r[0]));
      if (ids.length === 0) break;
      out.deletedPages += this.removeAll(ids).deletedPages;
    }
    out.liveBytesAfter = live();
    return out;
  }

  integrityCheck(): IntegrityReport {
    const sqlite = this.db.selectArrays('PRAGMA integrity_check').map((r) => String(r[0]));
    const check = (t: string): string => {
      try {
        this.db.exec(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`);
        return 'ok';
      } catch (e) {
        return String(e);
      }
    };
    const n = (sql: string) => Number(this.db.selectValue(sql));
    const pages = n('SELECT count(*) FROM pages');
    const ftsMainDocs = n('SELECT count(*) FROM fts_main_docsize');
    const ftsMetaDocs = n('SELECT count(*) FROM fts_meta');
    const fts = { main: check('fts_main'), meta: check('fts_meta'), snippets: check('fts_snip') };
    const consistent = pages === ftsMainDocs && pages === ftsMetaDocs;
    return { ok: sqlite[0] === 'ok' && Object.values(fts).every((v) => v === 'ok') && consistent, sqlite, fts, consistency: { pages, ftsMainDocs, ftsMetaDocs, consistent } };
  }

  // ------------------------------------------------------------------ export / import

  exportData(scope: 'saved' | 'all', now: number): ExportData {
    const where = scope === 'saved' ? `WHERE (p.flags & ${PAGE_FLAGS.saved}) != 0` : '';
    const pages = this.db
      .selectArrays(
        `SELECT p.url, p.title, p.first_seen, p.last_visit, p.visit_count, p.typed_count, p.lang, p.flags, p.saved_at, p.content_hash, p.content_indexed_at, coalesce(c.headings,''), coalesce(c.description,''), coalesce(c.body,'') FROM pages p LEFT JOIN contents c ON c.page_id = p.id ${where} ORDER BY p.url`,
      )
      .map((r) => ({
        url: String(r[0]),
        title: String(r[1]),
        firstSeen: Number(r[2]),
        lastVisit: Number(r[3]),
        visitCount: Number(r[4]),
        typedCount: Number(r[5]),
        lang: r[6] === null ? null : String(r[6]),
        flags: scope === 'saved' ? Number(r[7]) & ~PAGE_FLAGS.history : Number(r[7]),
        savedAt: r[8] === null ? null : Number(r[8]),
        contentHash: r[9] === null ? null : String(r[9]),
        contentIndexedAt: r[10] === null ? null : Number(r[10]),
        headings: String(r[11]),
        description: String(r[12]),
        body: String(r[13]),
      }));
    const snippets = this.db
      .selectArrays('SELECT url, page_title, text, fragment, truncated, created_at FROM snippets ORDER BY created_at, id')
      .map((r) => ({ url: String(r[0]), pageTitle: String(r[1]), text: String(r[2]), fragment: r[3] === null ? null : String(r[3]), truncated: Number(r[4]) === 1, createdAt: Number(r[5]) }));
    return { format: 'browser-recall-export', version: 1, exportedAt: now, scope, pages, snippets };
  }

  /** Idempotent import (re-importing the same file changes nothing). Pages are upserted by URL; snippets deduplicated. */
  importData(data: ExportData): { pages: number; snippets: number; skipped: number } {
    let pages = 0;
    let snippets = 0;
    let skipped = 0;
    this.db.transaction(() => {
      for (const p of data.pages) {
        const norm = normalizeUrl(p.url);
        if (!norm) {
          skipped++;
          continue;
        }
        const id = this.ensurePage(norm.url, norm.domain, p.title, p.firstSeen);
        this.writeContents(id, { headings: p.headings, description: p.description, body: p.body });
        this.run({
          sql: 'UPDATE pages SET title = ?, first_seen = min(first_seen, ?), last_visit = max(last_visit, ?), visit_count = max(visit_count, ?), typed_count = max(typed_count, ?), lang = ?, flags = flags | ?, saved_at = coalesce(saved_at, ?), content_hash = ?, content_indexed_at = ? WHERE id = ?',
          bind: [clip(p.title, LIMITS.title), p.firstSeen, p.lastVisit, p.visitCount, p.typedCount, p.lang, p.flags, p.savedAt, p.contentHash, p.contentIndexedAt, id],
        });
        this.reindex(id);
        pages++;
      }
      for (const s of data.snippets) {
        const norm = normalizeUrl(s.url);
        if (!norm) {
          skipped++;
          continue;
        }
        const dup = this.db.selectValue('SELECT id FROM snippets WHERE url = ? AND text = ? AND created_at = ?', [norm.url, s.text, s.createdAt]);
        if (dup !== undefined && dup !== null) continue;
        this.run({ sql: 'INSERT INTO snippets(url, domain, page_title, text, fragment, truncated, created_at) VALUES(?,?,?,?,?,?,?)', bind: [norm.url, norm.domain, s.pageTitle, s.text, s.fragment, s.truncated ? 1 : 0, s.createdAt] });
        const id = Number(this.db.selectValue('SELECT last_insert_rowid()'));
        this.run({ sql: 'INSERT INTO fts_snip(rowid, text, page_title) VALUES(?,?,?)', bind: [id, fold(s.text), fold(s.pageTitle)] });
        snippets++;
      }
    });
    return { pages, snippets, skipped };
  }

  get schemaVersion(): number {
    return LATEST_SCHEMA_VERSION;
  }

  close(): void {
    this.finalizeStatements();
    this.db.close();
  }
}

interface SearchContext {
  q: ParsedQuery;
  terms: string[];
  prefixIndex: number;
  now: number;
}
