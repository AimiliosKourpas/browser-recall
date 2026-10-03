import { describe, expect, it } from 'vitest';
import { createEngineClient } from '../src/background/engine-client';
import type { OffscreenManager } from '../src/background/offscreen-manager';
import { EngineError } from '../src/engine/errors';

const info = { protocol: 1, instanceId: 'abc' };
const okResponse = { ok: true, data: info };
const noSleep = { sleep: async () => undefined };

function setup(sendMessage: (n: number) => Promise<unknown>) {
  let ensures = 0;
  let sends = 0;
  const offscreen: OffscreenManager = { ensure: async () => void ensures++, close: async () => undefined };
  const client = createEngineClient({ offscreen, sendMessage: () => sendMessage(++sends), retry: noSleep });
  return { client, counts: () => ({ ensures, sends }) };
}

describe('engine client', () => {
  it('ensures the offscreen document, then returns the validated engine info', async () => {
    const { client, counts } = setup(async () => okResponse);
    expect(await client.ping()).toEqual(info);
    expect(counts()).toEqual({ ensures: 1, sends: 1 });
  });
  it('recovers while the offscreen document is still starting ("receiving end does not exist")', async () => {
    const { client, counts } = setup(async (n) => {
      if (n < 3) throw new Error('Could not establish connection. Receiving end does not exist.');
      return okResponse;
    });
    expect(await client.ping()).toEqual(info);
    expect(counts()).toEqual({ ensures: 3, sends: 3 }); // existence is re-checked on every attempt
  });
  it('recovers from an interrupted in-flight message (document closed mid-request)', async () => {
    const { client } = setup(async (n) => {
      if (n === 1) throw new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received');
      return okResponse;
    });
    expect(await client.ping()).toEqual(info);
  });
  it('retries when the engine worker died mid-call ("engine-unavailable"), but not for final typed errors', async () => {
    const died = setup(async (n) => (n < 3 ? { ok: false, error: { code: 'engine-unavailable', message: 'engine worker terminated' } } : okResponse));
    expect(await died.client.ping()).toEqual(info);
    expect(died.counts().sends).toBe(3);
    for (const code of ['open-failed', 'db-too-new', 'bad-request', 'internal'] as const) {
      const f = setup(async () => ({ ok: false, error: { code, message: `m-${code}` } }));
      await expect(f.client.ping()).rejects.toMatchObject({ code, message: `m-${code}` });
      expect(f.counts().sends).toBe(1);
    }
  });
  it('sends validated engine calls and returns typed data', async () => {
    const seen: unknown[] = [];
    const offscreen: OffscreenManager = { ensure: async () => undefined, close: async () => undefined };
    const client = createEngineClient({ offscreen, retry: noSleep, sendMessage: async (m) => (seen.push(m), { ok: true, data: { inserted: 1, updated: 0, skipped: 0 } }) });
    expect(await client.call({ method: 'upsertHistory', params: { rows: [] } })).toEqual({ inserted: 1, updated: 0, skipped: 0 });
    expect(seen).toEqual([{ target: 'engine', type: 'engine/call', call: { method: 'upsertHistory', params: { rows: [] } } }]);
  });
  it('does not retry engine-reported errors or malformed responses', async () => {
    const a = setup(async () => ({ ok: false, error: { code: 'internal', message: 'db locked' } }));
    await expect(a.client.ping()).rejects.toThrow('db locked');
    await expect(a.client.ping()).rejects.toBeInstanceOf(EngineError);
    expect(a.counts().sends).toBe(2);
    const b = setup(async () => ({ nonsense: true }));
    await expect(b.client.ping()).rejects.toThrow('malformed');
    expect(b.counts().sends).toBe(1);
  });
  it('gives up after the attempt budget', async () => {
    const { client, counts } = setup(async () => {
      throw new Error('Receiving end does not exist');
    });
    await expect(client.ping()).rejects.toThrow('Receiving end');
    expect(counts().sends).toBe(8);
  });
});
