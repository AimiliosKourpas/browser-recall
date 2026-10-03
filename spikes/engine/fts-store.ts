// FTS5 store used by the M0 spikes. Mirrors ARCHITECTURE.md §5.1 (pages / contents / fts_main / fts_meta).
// Takes any sqlite-wasm oo1 database handle, so the same code runs in Node (memory) and in Chromium (opfs-sahpool).
import type { Doc } from '../shared/corpus';

// Minimal structural type for the parts of oo1.DB we use.
export interface Db {
  exec(opts: string | { sql: string; bind?: unknown[]; rowMode?: 'array' | 'object'; returnValue?: 'resultRows'; callback?: (row: unknown) => void }): unknown;
  prepare(sql: string): Stmt;
  transaction<T>(cb: () => T): T;
  selectValue(sql: string, bind?: unknown[]): unknown;
  selectArrays(sql: string, bind?: unknown[]): unknown[][];
  close(): void;
}
export interface Stmt {
  bind(v: unknown[]): Stmt;
  step(): boolean;
  reset(): Stmt;
  finalize(): void;
  get(i: number): unknown;
}

export interface SchemaOpts {
  prefix?: string; // e.g. '2 3' or ''
  detail?: 'full' | 'column' | 'none';
  trigram?: boolean;
  /** Original M0 design (external-content FTS over the stored text, no TypeScript folding). Kept only so profile.ts / early numbers stay reproducible. */
  legacyExternalContent?: boolean;
}

/**
 * Accent/case folding done in TypeScript before text reaches FTS5.
 * M0 finding: unicode61 `remove_diacritics 2` folds Latin diacritics but NOT the Greek tonos/dialytika (see engine.test.ts).
 */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export const schemaSql = (o: SchemaOpts = {}): string => SCHEMA_BASE(o);

const SCHEMA_BASE = (o: SchemaOpts): string => `
PRAGMA page_size=4096;
CREATE TABLE IF NOT EXISTS pages(
  id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, domain TEXT NOT NULL,
  last_visit INTEGER NOT NULL, visit_count INTEGER NOT NULL DEFAULT 1, flags INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS pages_domain ON pages(domain, last_visit);
CREATE INDEX IF NOT EXISTS pages_last_visit ON pages(last_visit);
CREATE TABLE IF NOT EXISTS contents(id INTEGER PRIMARY KEY, title TEXT, body TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_main USING fts5(
  title, body, ${o.legacyExternalContent ? "content='contents', content_rowid='id'" : "content='', contentless_delete=1"},
  tokenize='unicode61 remove_diacritics 2'${(o.prefix ?? '3') ? `, prefix='${o.prefix ?? '3'}'` : ''}${o.detail && o.detail !== 'full' ? `, detail=${o.detail}` : ''});
CREATE VIRTUAL TABLE IF NOT EXISTS fts_meta USING fts5(
  title, url, tokenize='trigram');
`;

export interface Hit {
  id: number;
  score: number;
}

export class FtsStore {
  private readonly legacy: boolean;
  constructor(readonly db: Db, schema: SchemaOpts = {}) {
    this.legacy = !!schema.legacyExternalContent;
    db.exec(schemaSql(schema));
  }

  /** Insert in transactions of `batch` pages (ARCHITECTURE §5.5). */
  insertAll(docs: Doc[], batch = 100, withTrigram = true): void {
    for (let i = 0; i < docs.length; i += batch) {
      const slice = docs.slice(i, i + batch);
      this.db.transaction(() => {
        const p = this.db.prepare('INSERT INTO pages(id,url,domain,last_visit,visit_count) VALUES(?,?,?,?,?)');
        const c = this.db.prepare('INSERT INTO contents(id,title,body) VALUES(?,?,?)');
        const f = this.db.prepare('INSERT INTO fts_main(rowid,title,body) VALUES(?,?,?)');
        const m = this.db.prepare('INSERT INTO fts_meta(rowid,title,url) VALUES(?,?,?)');
        for (const d of slice) {
          p.bind([d.id, d.url, d.domain, d.lastVisit, d.visitCount]).step();
          p.reset();
          c.bind([d.id, d.title, d.body]).step();
          c.reset();
          if (this.legacy) f.bind([d.id, d.title, d.body]).step();
          else f.bind([d.id, fold(d.title), fold(d.body)]).step();
          f.reset();
          if (withTrigram) {
            m.bind([d.id, fold(d.title), fold(d.url)]).step();
            m.reset();
          }
        }
        p.finalize();
        c.finalize();
        f.finalize();
        m.finalize();
      });
    }
  }

  /** FTS5 match expression: all terms required, last term as prefix (SPEC §5.2). Terms are quoted, never raw SQL. */
  static toMatch(query: string, legacy = false): string {
    const terms = (legacy ? query : fold(query)).split(/\s+/).filter(Boolean).map((t) => t.replace(/"/g, '""'));
    return terms.map((t, i) => (i === terms.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
  }

  /** Top-200 candidate retrieval with optional domain/date filters; weights title 10, body 1. */
  search(query: string, opts: { domain?: string; after?: number; limit?: number } = {}): Hit[] {
    const limit = opts.limit ?? 200;
    const where: string[] = ['fts_main MATCH ?'];
    const bind: unknown[] = [FtsStore.toMatch(query, this.legacy)];
    if (opts.domain) {
      where.push('(p.domain = ? OR p.domain LIKE ?)');
      bind.push(opts.domain, `%.${opts.domain}`);
    }
    if (opts.after !== undefined) {
      where.push('p.last_visit >= ?');
      bind.push(opts.after);
    }
    bind.push(limit);
    const rows = this.db.selectArrays(
      `SELECT p.id, bm25(fts_main, 10.0, 1.0) AS s FROM fts_main JOIN pages p ON p.id = fts_main.rowid
       WHERE ${where.join(' AND ')} ORDER BY s LIMIT ?`,
      bind,
    );
    return rows.map((r) => ({ id: r[0] as number, score: r[1] as number }));
  }

  snippets(query: string, ids: number[]): string[] {
    if (ids.length === 0) return [];
    if (!this.legacy) throw new Error('snippet() needs stored FTS content; use snippetsTs');
    const q = FtsStore.toMatch(query, true);
    const rows = this.db.selectArrays(
      `SELECT rowid, snippet(fts_main, 1, char(1), char(2), '…', 12) FROM fts_main
       WHERE fts_main MATCH ? AND rowid IN (${ids.map(() => '?').join(',')})`,
      [q, ...ids],
    );
    return rows.map((r) => String(r[1]));
  }

  /** Snippets built in TypeScript from the stored body (FTS5 snippet() re-evaluates the match and dominated p95; see M0 report). */
  snippetsTs(query: string, ids: number[]): string[] {
    const terms = query.split(/\s+/).filter(Boolean).map((t) => fold(t));
    const st = this.db.prepare('SELECT body FROM contents WHERE id = ?');
    const out: string[] = [];
    for (const id of ids) {
      st.bind([id]).step();
      const body = String(st.get(0));
      st.reset();
      const lower = fold(body); // NFD-stripping can change length for decomposed input; offsets are approximate
      void lower;
      let at = -1;
      for (const t of terms) {
        const i = lower.indexOf(t);
        if (i >= 0 && (at < 0 || i < at)) at = i;
      }
      out.push(body.slice(Math.max(0, at - 60), Math.max(0, at) + 120));
    }
    st.finalize();
    return out;
  }

  /** Trigram substring match on title+URL (fallback tier). */
  searchMeta(substr: string, limit = 50): number[] {
    return this.db
      .selectArrays('SELECT rowid FROM fts_meta WHERE fts_meta MATCH ? LIMIT ?', [`"${fold(substr).replace(/"/g, '""')}"`, limit])
      .map((r) => r[0] as number);
  }

  count(): number {
    return Number(this.db.selectValue('SELECT count(*) FROM pages'));
  }
}
