import { describe, expect, it } from 'vitest';
import { WORKER_READY, engineCallSchema, engineRequestSchema } from '../src/engine/contract';
import { EngineError, EngineOpenError } from '../src/engine/errors';
import { handleCall } from '../src/engine/handlers';
import { SearchStore } from '../src/engine/store';
import { openMemoryDb } from '../src/engine/sqlite';
import { serializeError, startEngineWorker } from '../src/engine/worker-main';
import { WorkerClient, type WorkerLike } from '../src/engine/worker-client';
import { EngineInterruptedError, EngineTimeoutError } from '../src/shared/errors';

type Listener = (e: never) => void;
class FakeWorker implements WorkerLike {
  listeners: Record<string, Listener[]> = {};
  sent: unknown[] = [];
  terminated = false;
  addEventListener(type: string, l: Listener) {
    (this.listeners[type] ??= []).push(l);
  }
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  emit(type: string, data?: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data } as never);
  }
}

const info = { protocol: 1 as const, instanceId: 'i1' };

describe('engine call schema, handlers and worker main', () => {
  it('ping is answered without touching the database', async () => {
    const getStore = () => Promise.reject(new Error('must not open'));
    expect(await handleCall({ method: 'ping' }, { info, getStore })).toEqual(info);
  });
  it('schemas reject unknown methods, bad ids and malformed params', () => {
    expect(engineRequestSchema.safeParse({ id: 1, call: { method: 'dropEverything' } }).success).toBe(false);
    expect(engineRequestSchema.safeParse({ id: -1, call: { method: 'ping' } }).success).toBe(false);
    expect(engineRequestSchema.safeParse({ id: 1, call: { method: 'ping' } }).success).toBe(true);
    expect(engineCallSchema.safeParse({ method: 'search', params: { query: 'x'.repeat(1001) } }).success).toBe(false);
    expect(engineCallSchema.safeParse({ method: 'search', params: { query: 'ok', limit: 0 } }).success).toBe(false);
    expect(engineCallSchema.safeParse({ method: 'upsertHistory', params: { rows: [{ url: 'https://a.example/', lastVisitTime: -1 }] } }).success).toBe(false);
    expect(engineCallSchema.safeParse({ method: 'deleteUrls', params: { urls: 'https://a.example/' } }).success).toBe(false);
    expect(engineCallSchema.safeParse({ method: 'upsertHistory', params: { rows: [{ url: 'https://a.example/', lastVisitTime: 1 }] } }).success).toBe(true);
  });
  it('errors serialize with typed codes', () => {
    expect(serializeError(new EngineOpenError('locked', 3))).toEqual({ code: 'open-failed', message: 'locked' });
    expect(serializeError(new EngineError('bad-request', 'x'))).toEqual({ code: 'bad-request', message: 'x' });
    expect(serializeError(new Error('boom'))).toEqual({ code: 'internal', message: 'boom' });
    expect(serializeError('str')).toEqual({ code: 'internal', message: 'str' });
  });

  function host(openStore: () => Promise<SearchStore>) {
    const out: unknown[] = [];
    const scope = { onmessage: null as null | ((e: MessageEvent<unknown>) => void), postMessage: (m: unknown) => void out.push(m) };
    startEngineWorker(scope, { openStore });
    const send = (id: number, call: unknown) => scope.onmessage?.({ data: { id, call } } as MessageEvent<unknown>);
    const reply = async (id: number) => {
      await expect.poll(() => out.some((m) => (m as { id?: number }).id === id)).toBe(true);
      return out.find((m) => (m as { id?: number }).id === id) as { ok: boolean; result?: unknown; error?: { code: string } };
    };
    return { out, scope, send, reply };
  }

  it('announces readiness, answers ping, ignores junk, and serves real engine calls over the worker protocol', async () => {
    const store = SearchStore.open(await openMemoryDb());
    const h = host(async () => store);
    expect(h.out[0]).toEqual(WORKER_READY);
    h.scope.onmessage?.({ data: { junk: true } } as MessageEvent<unknown>);
    h.scope.onmessage?.({ data: { id: 1, call: { method: 'nope' } } } as MessageEvent<unknown>);
    expect(h.out).toHaveLength(1);
    h.send(2, { method: 'ping' });
    expect(await h.reply(2)).toMatchObject({ ok: true, result: { protocol: 1 } });
    h.send(3, { method: 'upsertHistory', params: { rows: [{ url: 'https://a.example/x', title: 'Worker page', lastVisitTime: 5 }] } });
    expect(await h.reply(3)).toMatchObject({ ok: true, result: { inserted: 1 } });
    h.send(4, { method: 'search', params: { query: 'worker', now: 10 } });
    const r = (await h.reply(4)).result as { results: { url: string }[] };
    expect(r.results.map((x) => x.url)).toEqual(['https://a.example/x']);
  });
  it('processes calls strictly one at a time, in order', async () => {
    const store = SearchStore.open(await openMemoryDb());
    const h = host(async () => store);
    for (let i = 0; i < 5; i++) h.send(10 + i, { method: 'upsertHistory', params: { rows: [{ url: `https://a.example/${i}`, title: `Item ${i}`, lastVisitTime: i }] } });
    await h.reply(14);
    expect(h.out.filter((m) => typeof (m as { id?: number }).id === 'number').map((m) => (m as { id: number }).id)).toEqual([10, 11, 12, 13, 14]);
  });
  it('a failed open is reported with its typed code and is NOT cached: the next call retries and recovers', async () => {
    let attempts = 0;
    const real = SearchStore.open(await openMemoryDb());
    const h = host(async () => {
      attempts++;
      if (attempts === 1) throw new EngineOpenError('locked after retries', 60);
      return real;
    });
    h.send(1, { method: 'stats' });
    expect(await h.reply(1)).toMatchObject({ ok: false, error: { code: 'open-failed' } });
    h.send(2, { method: 'stats' });
    expect(await h.reply(2)).toMatchObject({ ok: true });
    expect(attempts).toBe(2);
  });
  it('a database from a newer version surfaces db-too-new', async () => {
    const db = await openMemoryDb();
    SearchStore.open(db);
    db.exec("UPDATE meta SET value='99' WHERE key='schema_version'");
    const h = host(async () => SearchStore.open(db));
    h.send(1, { method: 'stats' });
    expect(await h.reply(1)).toMatchObject({ ok: false, error: { code: 'db-too-new' } });
  });
});

describe('WorkerClient', () => {
  it('waits for ready, then resolves a call', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w);
    const p = client.call({ method: 'ping' });
    await Promise.resolve();
    expect(w.sent).toEqual([]); // not sent before the worker says it is ready
    w.emit('message', WORKER_READY);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.sent).toEqual([{ id: 1, call: { method: 'ping' } }]);
    w.emit('message', { id: 1, ok: true, result: info });
    expect(await p).toEqual(info);
  });
  it('rejects an engine-reported error', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w);
    w.emit('message', WORKER_READY);
    const p = client.call({ method: 'ping' });
    await new Promise((r) => setTimeout(r, 0));
    w.emit('message', { id: 1, ok: false, error: { message: 'nope' } });
    await expect(p).rejects.toThrow('nope');
  });
  it('rejects every in-flight call with EngineInterruptedError when the worker dies, and refuses new calls', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w);
    w.emit('message', WORKER_READY);
    const p1 = client.call({ method: 'ping' });
    const p2 = client.call({ method: 'ping' });
    await new Promise((r) => setTimeout(r, 0));
    w.emit('error');
    await expect(p1).rejects.toBeInstanceOf(EngineInterruptedError);
    await expect(p2).rejects.toBeInstanceOf(EngineInterruptedError);
    await expect(client.call({ method: 'ping' })).rejects.toBeInstanceOf(EngineInterruptedError);
  });
  it('times out calls instead of hanging', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w, 20);
    w.emit('message', WORKER_READY);
    await expect(client.call({ method: 'ping' })).rejects.toBeInstanceOf(EngineTimeoutError);
  });
  it('ignores responses with unknown ids and malformed messages', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w, 50);
    w.emit('message', WORKER_READY);
    const p = client.call({ method: 'ping' });
    await new Promise((r) => setTimeout(r, 0));
    w.emit('message', { id: 99, ok: true, result: info });
    w.emit('message', 'garbage');
    w.emit('message', undefined);
    await expect(p).rejects.toBeInstanceOf(EngineTimeoutError);
  });
});
