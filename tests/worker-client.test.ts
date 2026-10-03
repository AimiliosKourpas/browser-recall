import { describe, expect, it } from 'vitest';
import { WORKER_READY, engineRequestSchema } from '../src/engine/contract';
import { handleRequest } from '../src/engine/handlers';
import { startEngineWorker } from '../src/engine/worker-main';
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

describe('engine handlers + worker main', () => {
  it('ping returns the engine info with the request id', () => {
    expect(handleRequest({ id: 7, method: 'ping' }, info)).toEqual({ id: 7, ok: true, result: info });
  });
  it('request schema rejects unknown methods and bad ids', () => {
    expect(engineRequestSchema.safeParse({ id: 1, method: 'drop' }).success).toBe(false);
    expect(engineRequestSchema.safeParse({ id: -1, method: 'ping' }).success).toBe(false);
    expect(engineRequestSchema.safeParse({ id: 1, method: 'ping' }).success).toBe(true);
  });
  it('startEngineWorker announces readiness, answers ping, ignores junk', () => {
    const out: unknown[] = [];
    const scope = { onmessage: null as null | ((e: MessageEvent<unknown>) => void), postMessage: (m: unknown) => void out.push(m) };
    startEngineWorker(scope);
    expect(out[0]).toEqual(WORKER_READY);
    scope.onmessage?.({ data: { junk: true } } as MessageEvent<unknown>);
    expect(out).toHaveLength(1);
    scope.onmessage?.({ data: { id: 3, method: 'ping' } } as MessageEvent<unknown>);
    expect(out[1]).toMatchObject({ id: 3, ok: true, result: { protocol: 1 } });
  });
});

describe('WorkerClient', () => {
  it('waits for ready, then resolves a call', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w);
    const p = client.call('ping');
    await Promise.resolve();
    expect(w.sent).toEqual([]); // not sent before the worker says it is ready
    w.emit('message', WORKER_READY);
    await new Promise((r) => setTimeout(r, 0));
    expect(w.sent).toEqual([{ id: 1, method: 'ping' }]);
    w.emit('message', { id: 1, ok: true, result: info });
    expect(await p).toEqual(info);
  });
  it('rejects an engine-reported error', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w);
    w.emit('message', WORKER_READY);
    const p = client.call('ping');
    await new Promise((r) => setTimeout(r, 0));
    w.emit('message', { id: 1, ok: false, error: { message: 'nope' } });
    await expect(p).rejects.toThrow('nope');
  });
  it('rejects every in-flight call with EngineInterruptedError when the worker dies, and refuses new calls', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w);
    w.emit('message', WORKER_READY);
    const p1 = client.call('ping');
    const p2 = client.call('ping');
    await new Promise((r) => setTimeout(r, 0));
    w.emit('error');
    await expect(p1).rejects.toBeInstanceOf(EngineInterruptedError);
    await expect(p2).rejects.toBeInstanceOf(EngineInterruptedError);
    await expect(client.call('ping')).rejects.toBeInstanceOf(EngineInterruptedError);
  });
  it('times out calls instead of hanging', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w, 20);
    w.emit('message', WORKER_READY);
    await expect(client.call('ping')).rejects.toBeInstanceOf(EngineTimeoutError);
  });
  it('ignores responses with unknown ids and malformed messages', async () => {
    const w = new FakeWorker();
    const client = new WorkerClient(w, 50);
    w.emit('message', WORKER_READY);
    const p = client.call('ping');
    await new Promise((r) => setTimeout(r, 0));
    w.emit('message', { id: 99, ok: true, result: info });
    w.emit('message', 'garbage');
    w.emit('message', undefined);
    await expect(p).rejects.toBeInstanceOf(EngineTimeoutError);
  });
});
