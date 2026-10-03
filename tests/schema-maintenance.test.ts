import { describe, expect, it } from 'vitest';
import { DatabaseTooNewError, EngineOpenError } from '../src/engine/errors';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, migrate, readSchemaVersion, type Migration } from '../src/engine/schema';
import { SearchStore } from '../src/engine/store';
import { OPFS_OPEN_RETRY, openMemoryDb, openOpfsDb } from '../src/engine/sqlite';
import { NOW, content, hist, newStore } from './helpers/engine';

describe('schema and migrations', () => {
  it('creates the current schema, records the version, auto_vacuum=incremental, and is idempotent', async () => {
    const db = await openMemoryDb();
    expect(readSchemaVersion(db)).toBe(0);
    migrate(db);
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(Number(db.selectValue('PRAGMA auto_vacuum'))).toBe(2);
    migrate(db);
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const tables = db.selectArrays("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r[0]);
    expect(tables).toEqual(expect.arrayContaining(['pages', 'contents', 'snippets', 'meta', 'fts_main', 'fts_meta', 'fts_snip', 'fts_vocab']));
  });
  it('FTS tables follow the validated design: contentless_delete, prefix 3, phrase queries not disabled', async () => {
    const db = await openMemoryDb();
    migrate(db);
    const ddl = String(db.selectValue("SELECT sql FROM sqlite_master WHERE name='fts_main'"));
    expect(ddl).toMatch(/content=''/);
    expect(ddl).toMatch(/contentless_delete=1/);
    expect(ddl).toMatch(/prefix='3'/);
    expect(ddl).not.toMatch(/detail\s*=/);
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1)); // numbered without gaps
  });
  it('upgrades a database created by an earlier schema version, keeping its data', async () => {
    const v1 = MIGRATIONS[0] as Migration;
    const v2: Migration = { version: 2, sql: 'ALTER TABLE pages ADD COLUMN note TEXT; UPDATE pages SET note = title;' };
    const db = await openMemoryDb();
    migrate(db, [v1]); // the "previous release" fixture
    const old = SearchStore.open(db, [v1]);
    old.upsertHistory([hist('https://a.example/', 'Kept across upgrade')]);
    expect(readSchemaVersion(db)).toBe(1);
    const upgraded = SearchStore.open(db, [v1, v2]);
    expect(readSchemaVersion(db)).toBe(2);
    expect(upgraded.search({ query: 'upgrade', now: NOW }).results).toHaveLength(1);
    expect(db.selectValue('SELECT note FROM pages')).toBe('Kept across upgrade');
  });
  it('a failing migration rolls back completely and leaves the previous version intact', async () => {
    const v1 = MIGRATIONS[0] as Migration;
    const bad: Migration = { version: 2, sql: 'CREATE TABLE half_done(x); INSERT INTO nope VALUES (1);' };
    const db = await openMemoryDb();
    migrate(db, [v1]);
    expect(() => migrate(db, [v1, bad])).toThrow();
    expect(readSchemaVersion(db)).toBe(1);
    expect(Number(db.selectValue("SELECT count(*) FROM sqlite_master WHERE name='half_done'"))).toBe(0);
  });
  it('downgrade protection: a database newer than the code is refused and untouched', async () => {
    const db = await openMemoryDb();
    migrate(db);
    db.exec("UPDATE meta SET value='99' WHERE key='schema_version'");
    expect(() => SearchStore.open(db)).toThrowError(DatabaseTooNewError);
    try {
      SearchStore.open(db);
    } catch (e) {
      expect(e).toMatchObject({ code: 'db-too-new', found: 99, supported: LATEST_SCHEMA_VERSION });
    }
    expect(readSchemaVersion(db)).toBe(99);
  });
});

describe('maintenance and vacuum (A7)', () => {
  async function churned() {
    const { store, db } = await newStore();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 200; i++) {
        store.upsertHistory([hist(`https://c.example/${round}/${i}`, `title ${i}`)]);
        store.upsertContent(content(`https://c.example/${round}/${i}`, `content words ${i} `.repeat(150)));
      }
      store.deleteDomain('c.example');
    }
    return { store, db };
  }
  it('churn leaves free pages; bounded incremental_vacuum reclaims them step by step; data stays intact', async () => {
    const { store } = await churned();
    store.savePage({ url: 'https://keep.example/', title: 'Kept', body: 'survives vacuum', savedAt: NOW });
    const before = store.stats();
    expect(before.freelistPages).toBeGreaterThan(60);
    const first = store.maintenance({ vacuumPages: 30 });
    expect(first).toMatchObject({ freelistBefore: before.freelistPages, vacuumedPages: 30 });
    expect(first.freelistAfter).toBe(before.freelistPages - 30);
    expect(store.stats().dbBytes).toBeLessThan(before.dbBytes);
    for (let i = 0; i < 100 && store.stats().freelistPages > 0; i++) store.maintenance({ vacuumPages: 500, minFreePages: 1 });
    expect(store.stats().freelistPages).toBe(0);
    expect(store.stats().dbBytes).toBeLessThan(before.dbBytes / 2);
    expect(store.search({ query: 'survives', now: NOW }).results).toHaveLength(1);
    expect(store.integrityCheck().ok).toBe(true);
  });
  it('does nothing when the free list is below the threshold (not run on every operation)', async () => {
    const { store } = await newStore();
    store.upsertHistory([hist('https://a.example/', 'A')]);
    expect(store.maintenance()).toMatchObject({ vacuumedPages: 0, ftsMerged: false });
  });
  it('never reclaims more than the requested bound and optionally runs a bounded FTS merge', async () => {
    const { store } = await churned();
    const before = store.stats().freelistPages;
    const out = store.maintenance({ vacuumPages: 10, ftsMerge: true });
    expect(out.vacuumedPages).toBe(10);
    expect(out.freelistAfter).toBe(before - 10);
    expect(out.ftsMerged).toBe(true);
    expect(store.integrityCheck().ok).toBe(true);
  });
});

describe('OPFS open: bounded retry/backoff (A3)', () => {
  const locked = () => new Error("NoModificationAllowedError: Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle");
  class FakeDb {}
  const pool = { OpfsSAHPoolDb: FakeDb as never };
  const fast = { baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined };

  it('retries while the previous owner still holds the handles, then opens the same file', async () => {
    let calls = 0;
    const db = await openOpfsDb({ wasmUrl: 'x', install: async () => (++calls < 19 ? Promise.reject(locked()) : pool), retry: fast });
    expect(calls).toBe(19); // the M0 measurement: 19 attempts ≈ 2 s
    expect(db).toBeInstanceOf(FakeDb);
  });
  it('is bounded: gives a typed EngineOpenError when recovery is exhausted', async () => {
    let calls = 0;
    const attempt = openOpfsDb({ wasmUrl: 'x', install: async () => (calls++, Promise.reject(locked())), retry: { ...fast, attempts: 5 } });
    await expect(attempt).rejects.toBeInstanceOf(EngineOpenError);
    await expect(attempt).rejects.toMatchObject({ code: 'open-failed', attempts: 5 });
    expect(calls).toBe(5); // exactly the attempt budget, no infinite loop
  });
  it('does not retry unrelated errors', async () => {
    let calls = 0;
    await expect(openOpfsDb({ wasmUrl: 'x', install: async () => (calls++, Promise.reject(new Error('QuotaExceededError'))), retry: fast })).rejects.toMatchObject({ code: 'open-failed', attempts: 1 });
    expect(calls).toBe(1);
  });
  it('default budget covers the measured ~2 s window and stays bounded', () => {
    const worst = Array.from({ length: OPFS_OPEN_RETRY.attempts - 1 }, (_, i) => Math.min(OPFS_OPEN_RETRY.maxDelayMs, OPFS_OPEN_RETRY.baseDelayMs * 2 ** i)).reduce((a, b) => a + b, 0);
    expect(worst).toBeGreaterThan(5_000);
    expect(worst).toBeLessThan(20_000);
  });
});
