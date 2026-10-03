import { describe, expect, it } from 'vitest';
import { createOffscreenManager, type OffscreenApi } from '../src/background/offscreen-manager';

function fakeApi(opts: { createDelayMs?: number; createError?: () => Error } = {}) {
  let exists = false;
  const calls = { create: 0, close: 0 };
  const api: OffscreenApi = {
    hasDocument: async () => exists,
    create: async () => {
      calls.create++;
      await new Promise((r) => setTimeout(r, opts.createDelayMs ?? 0));
      if (opts.createError) throw opts.createError();
      exists = true;
    },
    close: async () => {
      calls.close++;
      exists = false;
    },
  };
  return { api, calls, setExists: (v: boolean) => (exists = v) };
}

describe('offscreen manager', () => {
  it('creates once for concurrent callers (promise lock)', async () => {
    const { api, calls } = fakeApi({ createDelayMs: 10 });
    const m = createOffscreenManager(api);
    await Promise.all([m.ensure(), m.ensure(), m.ensure()]);
    expect(calls.create).toBe(1);
  });
  it('does nothing if the document already exists', async () => {
    const { api, calls, setExists } = fakeApi();
    setExists(true);
    await createOffscreenManager(api).ensure();
    expect(calls.create).toBe(0);
  });
  it('recreates after the document was closed behind its back', async () => {
    const { api, calls, setExists } = fakeApi();
    const m = createOffscreenManager(api);
    await m.ensure();
    setExists(false);
    await m.ensure();
    expect(calls.create).toBe(2);
  });
  it('tolerates the "only a single offscreen document" race when it now exists', async () => {
    const f = fakeApi({ createError: () => new Error('Only a single offscreen document may be created.') });
    f.api.create = async () => {
      f.setExists(true); // someone else won the race
      throw new Error('Only a single offscreen document may be created.');
    };
    await expect(createOffscreenManager(f.api).ensure()).resolves.toBeUndefined();
  });
  it('propagates other creation errors and allows a later retry', async () => {
    let fail = true;
    const f = fakeApi();
    const original = f.api.create;
    f.api.create = async () => {
      if (fail) throw new Error('boom');
      return original();
    };
    const m = createOffscreenManager(f.api);
    await expect(m.ensure()).rejects.toThrow('boom');
    fail = false;
    await expect(m.ensure()).resolves.toBeUndefined();
  });
  it('close() only closes an existing document', async () => {
    const { api, calls } = fakeApi();
    const m = createOffscreenManager(api);
    await m.close();
    expect(calls.close).toBe(0);
    await m.ensure();
    await m.close();
    expect(calls.close).toBe(1);
  });
});
