// Structural subset of sqlite-wasm's oo1.DB that the engine uses. Keeps the storage layer testable with the in-memory
// build in Node and runnable on opfs-sahpool in the browser, and keeps raw SQL inside src/engine/store.
export interface Statement {
  bind(values: unknown[]): Statement;
  step(): boolean;
  reset(): Statement;
  finalize(): void;
  get(index: number): unknown;
}

export interface Db {
  exec(options: string | { sql: string; bind?: unknown[] }): unknown;
  prepare(sql: string): Statement;
  transaction<T>(callback: () => T): T;
  selectValue(sql: string, bind?: unknown[]): unknown;
  selectArrays(sql: string, bind?: unknown[]): unknown[][];
  close(): void;
}
