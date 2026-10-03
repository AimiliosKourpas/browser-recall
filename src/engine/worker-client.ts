// Typed request/response client for the engine worker, used by the offscreen document.
// Guarantees: every call settles (result, timeout, or EngineInterruptedError if the worker dies), so a caller never hangs on a dead engine.
import { WORKER_READY, type EngineCall, type EngineRequest, type EngineResponse, type EngineResults } from './contract';
import { EngineInterruptedError, EngineTimeoutError } from '../shared/errors';
import { EngineError } from './errors';

export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void;
  terminate(): void;
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> };

export class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private dead = false;
  private readonly ready: Promise<void>;

  /** `timeoutMs` bounds a single call; the first call also waits for the OPFS open (bounded retry inside the worker, ~10 s). */
  constructor(private readonly worker: WorkerLike, private readonly timeoutMs = 60_000) {
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
      if (data.ok) entry.resolve((data as { result: unknown }).result);
      else {
        const { code, message } = (data as { error: { code: ConstructorParameters<typeof EngineError>[0]; message: string } }).error;
        entry.reject(new EngineError(code, message));
      }
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

  async call<C extends EngineCall>(call: C): Promise<EngineResults[C['method']]> {
    if (this.dead) throw new EngineInterruptedError('engine worker terminated');
    await this.ready;
    const id = this.nextId++;
    return new Promise<EngineResults[C['method']]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EngineTimeoutError(`engine call ${call.method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.worker.postMessage({ id, call } satisfies EngineRequest);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
