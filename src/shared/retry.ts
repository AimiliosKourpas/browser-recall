export interface RetryOptions {
  attempts: number; // total tries, >= 1
  baseDelayMs: number;
  maxDelayMs: number;
  isRetryable: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff (base * 2^n, capped). Throws the last error when attempts are exhausted or the error is not retryable. */
export async function retryWithBackoff<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= opts.attempts || !opts.isRetryable(error)) throw error;
      await sleep(Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
