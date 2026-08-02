import type { JsonValue } from "../types";

/** Execution mode visible to lifecycle middleware. */
export type MiddlewareMode = "chat" | "stream";

/** Immutable context supplied before a run enters the core runtime loop. */
export interface MiddlewareContext {
  readonly runId: string;
  readonly agentName: string;
  readonly mode: MiddlewareMode;
  readonly sessionId?: string;
  readonly signal: AbortSignal;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

/** Context supplied after a run has a successful final result. */
export interface MiddlewareResultContext extends MiddlewareContext {
  readonly result: unknown;
}

/** Context supplied after a run fails; onError failures are isolated. */
export interface MiddlewareErrorContext extends MiddlewareContext {
  readonly error: Error;
}

/**
 * A composable lifecycle middleware.
 *
 * `before` executes in declaration order. `after` and `onError` execute in
 * reverse order, allowing wrappers such as timers and scoped logging.
 */
export interface RunnerMiddleware {
  readonly name: string;
  before?(context: MiddlewareContext): void | Promise<void>;
  after?(context: MiddlewareResultContext): void | Promise<void>;
  onError?(context: MiddlewareErrorContext): void | Promise<void>;
}

/** Factory input for a named lifecycle middleware. */
export type MiddlewareConfig = RunnerMiddleware;
