import { describe, expect, it } from 'vitest';
import { retryWithBackoff } from '../src/shared/retry';

const base = { attempts: 5, baseDelayMs: 100, maxDelayMs: 350, isRetryable: () => true };

describe('retryWithBackoff', () => {
  it('returns the first success without sleeping', async () => {
    const sleeps: number[] = [];
    expect(await retryWithBackoff(async () => 'ok', { ...base, sleep: async (ms) => void sleeps.push(ms) })).toBe('ok');
    expect(sleeps).toEqual([]);
  });
  it('backs off exponentially, capped, then succeeds', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const result = await retryWithBackoff(
      async (attempt) => {
        n = attempt;
        if (attempt < 5) throw new Error('busy');
        return 'done';
      },
      { ...base, sleep: async (ms) => void sleeps.push(ms) },
    );
    expect(result).toBe('done');
    expect(n).toBe(5);
    expect(sleeps).toEqual([100, 200, 350, 350]);
  });
  it('throws the last error when attempts are exhausted', async () => {
    await expect(retryWithBackoff(async (a) => Promise.reject(new Error(`fail ${a}`)), { ...base, attempts: 3, sleep: async () => undefined })).rejects.toThrow('fail 3');
  });
  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(async () => (calls++, Promise.reject(new Error('fatal'))), { ...base, isRetryable: () => false, sleep: async () => undefined }),
    ).rejects.toThrow('fatal');
    expect(calls).toBe(1);
  });
});
