// Numbered, forward-only migrations (ARCHITECTURE §9). The database records its version in `meta`; a database NEWER than the
// code is never modified (DatabaseTooNewError). Table design: M0 S2/S9 + ADR-002.
//  - fts_main is CONTENTLESS (contentless_delete=1) and holds FOLDED text supplied from TypeScript; the original text lives in
//    `contents` exactly once. Snippets are built in TypeScript from `contents` (never FTS5 snippet()).
//  - prefix='3' (prefix='2 3' blew the 2× size budget). No detail=none/column: phrase queries are required.
//  - auto_vacuum=INCREMENTAL is set before the first table exists so bounded incremental_vacuum works (A7).
import type { Db } from './db';
import { DatabaseTooNewError } from './errors';

export interface Migration {
  version: number;
  sql: string;
}

export const PAGE_FLAGS = { history: 1, content: 2, saved: 4 } as const;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE pages(
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  first_seen INTEGER NOT NULL,
  last_visit INTEGER NOT NULL,
  visit_count INTEGER NOT NULL DEFAULT 1,
  typed_count INTEGER NOT NULL DEFAULT 0,
  lang TEXT,
  flags INTEGER NOT NULL DEFAULT 0,
  saved_at INTEGER,
  content_hash TEXT,
  content_indexed_at INTEGER);
CREATE INDEX pages_domain ON pages(domain, last_visit);
CREATE INDEX pages_last_visit ON pages(last_visit);
CREATE INDEX pages_flags ON pages(flags);
CREATE TABLE contents(
  page_id INTEGER PRIMARY KEY,
  headings TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL DEFAULT 0);
CREATE TABLE snippets(
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  page_title TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  fragment TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL);
CREATE INDEX snippets_url ON snippets(url);
CREATE VIRTUAL TABLE fts_main USING fts5(
  title, headings, description, body,
  content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2', prefix='3');
CREATE VIRTUAL TABLE fts_meta USING fts5(title, url, tokenize='trigram');
CREATE VIRTUAL TABLE fts_snip USING fts5(
  text, page_title,
  content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2', prefix='3');
CREATE VIRTUAL TABLE fts_vocab USING fts5vocab(fts_main, 'row');
`,
  },
];

export const LATEST_SCHEMA_VERSION = (MIGRATIONS[MIGRATIONS.length - 1] as Migration).version;

export function readSchemaVersion(db: Db): number {
  const hasMeta = Number(db.selectValue("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='meta'")) > 0;
  if (!hasMeta) return 0;
  const v = db.selectValue("SELECT value FROM meta WHERE key='schema_version'");
  return v === undefined || v === null ? 0 : Number(v);
}

/** Creates or upgrades the schema. Each migration runs in its own transaction and records its version. */
export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): number {
  const latest = (migrations[migrations.length - 1] as Migration).version;
  const current = readSchemaVersion(db);
  if (current > latest) throw new DatabaseTooNewError(current, latest);
  if (current === 0) {
    // must precede the first table; harmless when the build/VFS ignores it
    db.exec('PRAGMA auto_vacuum=INCREMENTAL');
    db.exec('CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  for (const m of migrations) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.exec({ sql: "INSERT INTO meta(key,value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", bind: [String(m.version)] });
    });
  }
  return latest;
}
