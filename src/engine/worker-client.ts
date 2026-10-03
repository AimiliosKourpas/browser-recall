// Typed request/response client for the engine worker, used by the offscreen document.
// Guarantees: every call settles (result, timeout, or EngineInterruptedError if the worker dies), so a caller never hangs on a dead engine.
import { WORKER_READY, type EngineInfo, type EngineRequest, type EngineResponse } from './contract';
import { EngineInterruptedError, EngineTimeoutError } from '../shared/errors';

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  terminate(): void;
}

type Pending = { resolve: (value: EngineInfo) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> };

export class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private dead = false;
  private readonly ready: Promise<void>;

  constructor(private readonly worker: WorkerLike, private readonly timeoutMs = 10_000) {
    let markReady!: () => void;
    let markFailed!: (reason: unknown) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      markFailed = reject;
    });
    this.ready.catch(() => undefined); // surfaced through call(); avoid an unhandled rejection if nobody called yet
    worker.addEventListener('message', (event) => {
      const data = event.data as Partial<EngineResponse> & { ready?: boolean };
      if (data && data.ready === WORKER_READY.ready) return markReady();
      if (typeof data?.id !== 'number') return;
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      clearTimeout(entry.timer);
      if (data.ok) entry.resolve((data as { result: EngineInfo }).result);
      else entry.reject(new Error((data as { error: { message: string } }).error.message));
    });
    const onDeath = () => {
      this.dead = true;
      const error = new EngineInterruptedError('engine worker terminated');
      markFailed(error);
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
        this.pending.delete(id);
      }
    };
    worker.addEventListener('error', onDeath);
    worker.addEventListener('messageerror', onDeath);
  }

  async call(method: EngineRequest['method']): Promise<EngineInfo> {
    if (this.dead) throw new EngineInterruptedError('engine worker terminated');
    await this.ready;
    const id = this.nextId++;
    return new Promise<EngineInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineTimeoutError(`engine call ${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, method } satisfies EngineRequest);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
