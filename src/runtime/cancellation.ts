/** The cancellable deadline that belongs to one Runner invocation. */
export interface RunDeadline {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly dispose: () => void;
}

/** A cleanup handle for a signal linked from one or more parent signals. */
export interface CombinedAbortSignal {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}

/** Combines caller cancellation signals without relying on newer AbortSignal.any APIs. */
export function combineAbortSignals(
  signals: readonly (AbortSignal | undefined)[]
): CombinedAbortSignal {
  const controller = new AbortController();
  const listeners: Array<{ readonly signal: AbortSignal; readonly listener: () => void }> = [];

  for (const signal of signals) {
    if (signal === undefined) {
      continue;
    }
    const listener = (): void => {
      controller.abort(signal.reason);
    };
    if (signal.aborted) {
      listener();
      break;
    }
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ listener, signal });
  }

  return {
    dispose: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
    signal: controller.signal
  };
}

/** Combines a caller cancellation signal with an optional run-wide deadline. */
export function createRunDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): RunDeadline {
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Run timed out."));
    }, timeoutMs);
  }

  return {
    didTimeout: () => timedOut,
    dispose: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal
  };
}

/** Races an asynchronous operation with cancellation while safely observing late completion. */
/** Waits for a retry delay while remaining responsive to cancellation. */
export function delayWithSignal(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Operation was aborted."));
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason ?? new Error("Operation was aborted."));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Operation was aborted."));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason ?? new Error("Operation was aborted."));
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}
