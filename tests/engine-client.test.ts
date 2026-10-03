import { describe, expect, it } from 'vitest';
import { createEngineClient } from '../src/background/engine-client';
import type { OffscreenManager } from '../src/background/offscreen-manager';

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
  it('does not retry engine-reported errors or malformed responses', async () => {
    const a = setup(async () => ({ ok: false, error: { code: 'internal', message: 'db locked' } }));
    await expect(a.client.ping()).rejects.toThrow('db locked');
    expect(a.counts().sends).toBe(1);
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
