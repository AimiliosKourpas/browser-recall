// sqlite-wasm bootstrap: in-memory (tests, Node) and opfs-sahpool (the extension). SQLite WASM ships INSIDE the extension
// (public/sqlite3.wasm); nothing is ever fetched from a remote origin (ADR-010).
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Db } from './db';
import { EngineOpenError } from './errors';
import { retryWithBackoff, type RetryOptions } from '../shared/retry';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

interface SahPool {
  OpfsSAHPoolDb: new (filename: string) => Db;
}

let sqlitePromise: Promise<Sqlite3> | undefined;

/**
 * sqlite-wasm auto-installs the `opfs` and `opfs-wl` VFSes (they need a separate sqlite3-opfs-async-proxy.js worker we do not ship)
 * when it initialises in a worker; the attempt fails and logs console errors that Chrome lists on the extension's error page.
 * We only ever use `opfs-sahpool`, which stays enabled. sqlite reads this global once, at init.
 */
export const SQLITE_API_CONFIG = { disable: { vfs: { opfs: true, 'opfs-wl': true } } } as const;
(globalThis as unknown as { sqlite3ApiConfig?: object }).sqlite3ApiConfig = SQLITE_API_CONFIG;

/** `wasmUrl` (browser) tells the loader where the bundled sqlite3.wasm is; omitted under Node. */
export function loadSqlite(wasmUrl?: string): Promise<Sqlite3> {
  sqlitePromise ??= wasmUrl
    ? (sqlite3InitModule as unknown as (o: { locateFile: (f: string) => string }) => Promise<Sqlite3>)({ locateFile: (f) => (f.endsWith('.wasm') ? wasmUrl : f) })
    : sqlite3InitModule();
  return sqlitePromise;
}

export async function openMemoryDb(): Promise<Db> {
  const sqlite3 = await loadSqlite();
  return new sqlite3.oo1.DB(':memory:', 'c') as unknown as Db;
}

/**
 * After an abrupt offscreen/worker shutdown the previous owner's OPFS sync access handles can stay locked for ~2 s
 * (M0 S3: 19 retries at 100 ms). Opening therefore retries with bounded backoff on exactly that error and nothing else.
 */
export const OPFS_OPEN_RETRY: Omit<RetryOptions, 'isRetryable'> = { attempts: 60, baseDelayMs: 100, maxDelayMs: 250 };
const isHandleLocked = (e: unknown) => /NoModificationAllowed|Access Handle|createSyncAccessHandle/i.test(String(e));

/**
 * Per-connection tuning (measured in e2e/engine-perf.spec.ts): a 32 MB page cache keeps the hot FTS pages in memory instead of
 * re-reading OPFS on every query. Durability pragmas are left at their defaults: M0 S3 showed clean recovery from SIGKILL
 * mid-write with them, and nothing here has been shown to need weaker settings.
 */
export function tuneConnection(db: Db): void {
  db.exec('PRAGMA cache_size = -32768');
}

export interface OpfsOptions {
  wasmUrl: string;
  directory?: string;
  filename?: string;
  retry?: Partial<RetryOptions>;
  /** test seam: replaces the real VFS install */
  install?: () => Promise<SahPool>;
}

export async function openOpfsDb(opts: OpfsOptions): Promise<Db> {
  const sqlite3 = await loadSqlite(opts.wasmUrl);
  const install =
    opts.install ??
    (() =>
      (sqlite3 as unknown as { installOpfsSAHPoolVfs(o: object): Promise<SahPool> }).installOpfsSAHPoolVfs({
        name: 'browser-recall',
        directory: opts.directory ?? '/browser-recall',
        clearOnInit: false,
        forceReinitIfPreviouslyFailed: true,
      }));
  let attempts = 0;
  try {
    const pool = await retryWithBackoff(
      async (attempt) => {
        attempts = attempt;
        return install();
      },
      { ...OPFS_OPEN_RETRY, isRetryable: isHandleLocked, ...opts.retry },
    );
    const db = new pool.OpfsSAHPoolDb(opts.filename ?? '/browser-recall.db');
    tuneConnection(db);
    return db;
  } catch (error) {
    throw new EngineOpenError(`could not open the local database after ${attempts} attempt(s): ${error instanceof Error ? error.message : String(error)}`, attempts, { cause: error });
  }
}
