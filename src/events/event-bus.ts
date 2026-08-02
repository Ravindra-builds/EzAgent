import type { EventListener } from "./types";

/** Called when an event listener throws or rejects. */
export type EventListenerErrorHandler = (input: {
  readonly event: string;
  readonly error: unknown;
}) => void;

/** Construction options for an EventBus. */
export interface EventBusOptions {
  /** Observes listener errors without allowing them to disrupt the producer. */
  readonly onListenerError?: EventListenerErrorHandler;
}

/** A function returned by `on` and `once` to unsubscribe a listener. */
export type Unsubscribe = () => void;

/**
 * A small, typed, framework-independent event bus.
 *
 * Event delivery is synchronous up to the point an async listener returns a
 * promise. Rejected listener promises are contained and reported through the
 * optional `onListenerError` callback, so observability cannot crash a run.
 */
export class EventBus<TEvents extends object = Record<string, unknown>> {
  private readonly listeners = new Map<string, Set<EventListener<unknown>>>();
  private readonly onListenerError: EventListenerErrorHandler | undefined;

  constructor(options: EventBusOptions = {}) {
    this.onListenerError = options.onListenerError;
  }

  /** Subscribes a listener and returns an idempotent unsubscribe function. */
  on<TKey extends keyof TEvents & string>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>
  ): Unsubscribe {
    const listeners = this.listeners.get(event) ?? new Set<EventListener<unknown>>();
    const internalListener = listener as unknown as EventListener<unknown>;
    listeners.add(internalListener);
    this.listeners.set(event, listeners);

    return () => {
      this.off(event, listener);
    };
  }

  /** Subscribes a listener that runs no more than once. */
  once<TKey extends keyof TEvents & string>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>
  ): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      return listener(payload);
    });
    return unsubscribe;
  }

  /** Removes a specific listener, returning whether it was registered. */
  off<TKey extends keyof TEvents & string>(
    event: TKey,
    listener: EventListener<TEvents[TKey]>
  ): boolean {
    const listeners = this.listeners.get(event);
    if (listeners === undefined) {
      return false;
    }

    const removed = listeners.delete(listener as unknown as EventListener<unknown>);
    if (listeners.size === 0) {
      this.listeners.delete(event);
    }
    return removed;
  }

  /** Emits an event to a stable snapshot of the currently registered listeners. */
  emit<TKey extends keyof TEvents & string>(event: TKey, payload: TEvents[TKey]): void {
    const listeners = this.listeners.get(event);
    if (listeners === undefined) {
      return;
    }

    for (const listener of [...listeners]) {
      try {
        const result = listener(payload);
        if (isPromiseLike(result)) {
          void result.catch((error: unknown) => this.reportListenerError(event, error));
        }
      } catch (error) {
        this.reportListenerError(event, error);
      }
    }
  }

  /** Returns the number of listeners currently registered for an event. */
  listenerCount<TKey extends keyof TEvents & string>(event: TKey): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Removes every listener, or every listener for one event. */
  clear<TKey extends keyof TEvents & string>(event?: TKey): void {
    if (event === undefined) {
      this.listeners.clear();
      return;
    }

    this.listeners.delete(event);
  }

  private reportListenerError(event: string, error: unknown): void {
    try {
      this.onListenerError?.({ error, event });
    } catch {
      // A diagnostics hook must not be able to interrupt runtime execution.
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
