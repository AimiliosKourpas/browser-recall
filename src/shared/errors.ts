/** The engine (offscreen document / worker) went away while a request was in flight. Callers may retry idempotent requests. */
export class EngineInterruptedError extends Error {
  override name = 'EngineInterruptedError';
}

/** The engine did not answer within the allotted time. */
export class EngineTimeoutError extends Error {
  override name = 'EngineTimeoutError';
}

/**
 * True for the Chrome messaging failures that mean "the other side is not (yet / any more) there":
 * the offscreen document is still starting, or it was closed mid-request (M0 S3: "message channel closed before a response was received").
 */
export function isTransientMessagingError(error: unknown): boolean {
  if (error instanceof EngineInterruptedError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|message channel closed|message port closed|Could not establish connection/i.test(message);
}
