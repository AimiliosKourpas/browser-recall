// Typed engine failures. `code` crosses the messaging boundary; callers branch on it, never on message text.
export type EngineErrorCode = 'bad-request' | 'open-failed' | 'db-too-new' | 'engine-unavailable' | 'internal';

export class EngineError extends Error {
  override name = 'EngineError';
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** The database file was written by a newer version of the extension: open read-only / offer export+reset (ARCHITECTURE §9). */
export class DatabaseTooNewError extends EngineError {
  override name = 'DatabaseTooNewError';
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super('db-too-new', `database schema v${found} is newer than the supported v${supported}`);
  }
}

/** Opening the database failed even after the bounded retry/backoff (M0 S3: handles can stay locked ~2 s after an abrupt close). */
export class EngineOpenError extends EngineError {
  override name = 'EngineOpenError';
  constructor(
    message: string,
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super('open-failed', message);
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}
