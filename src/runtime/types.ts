import type { EventBus } from "../events/event-bus";
import type { EzAgentEventMap } from "../events/types";
import type { RunnerMiddleware } from "../middleware/types";
import type { TraceExporter, RunTrace } from "../tracing/types";
import type {
  ChatMessage,
  JsonValue,
  MessageContent,
  ProviderResponse,
  ProviderUsage
} from "../types";
import type { StorageAdapter } from "../storage/types";
import type { ToolExecutor } from "../tools/tool-executor";

/** Provider retry policy. `maxAttempts` includes the initial provider attempt. */
export interface RetryPolicy {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly jitter?: boolean;
  /** Optional application policy for retrying nonstandard provider errors. */
  shouldRetry?(error: Error, attempt: number): boolean;
}

/** Fully resolved retry policy used internally for a run. */
export interface ResolvedRetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: boolean;
  readonly shouldRetry: (error: Error, attempt: number) => boolean;
}

/** Shared default safety limits and integrations for every Runner. */
export interface RunnerConfig {
  readonly maxIterations?: number;
  readonly maxToolCalls?: number;
  readonly maxHandoffs?: number;
  readonly timeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly maxOutputRetries?: number;
  readonly retry?: RetryPolicy;
  /** Persistence used when a run supplies a sessionId. */
  readonly storage?: StorageAdapter;
  /** Lifecycle middleware that runs before Agent plugin middleware. */
  readonly middleware?: readonly RunnerMiddleware[];
  /** Receives immutable terminal traces without affecting execution. */
  readonly traceExporter?: TraceExporter;
  /** Reuse an EventBus across runners or inject a test/event integration. */
  readonly eventBus?: EventBus<EzAgentEventMap>;
  /** Reuse or customize the component that validates and invokes tools. */
  readonly toolExecutor?: ToolExecutor;
  /** Optional deterministic ID source for tests and tracing integrations. */
  readonly generateRunId?: () => string;
}

/** Overrides for automatic factual-memory retrieval on one run. */
export interface MemoryRunOptions {
  readonly query?: string;
  readonly namespace?: string;
  readonly limit?: number;
}

/** Per-run input, context, session, memory, cancellation, and optional tighter limits. */
export interface RunOptions<TContext = unknown> {
  readonly input: MessageContent;
  readonly context?: TContext;
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
  /** Application metadata visible to middleware and tracing. */
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  /** Metadata merged into a new or persisted session after successful completion. */
  readonly sessionMetadata?: Readonly<Record<string, JsonValue>>;
  /** Set to false to suppress the Agent's configured factual-memory lookup. */
  readonly memory?: MemoryRunOptions | false;
  readonly maxIterations?: number;
  readonly maxToolCalls?: number;
  readonly maxHandoffs?: number;
  readonly timeoutMs?: number;
  readonly toolTimeoutMs?: number;
  readonly maxOutputRetries?: number;
  readonly retry?: RetryPolicy;
}

/** Immutable final value returned by `Runner.run`. */
export interface RunResult<TOutput = string> {
  readonly runId: string;
  /** Initial agent name supplied to Runner. */
  readonly agentName: string;
  /** Agent that produced the final response after any handoffs. */
  readonly finalAgentName: string;
  /** Parsed structured output when Agent.output is configured; otherwise final text. */
  readonly output: TOutput;
  /** Original final assistant text before structured-output parsing. */
  readonly text: string;
  readonly response: ProviderResponse;
  readonly message: ProviderResponse["message"];
  readonly messages: readonly ChatMessage[];
  readonly iterations: number;
  readonly toolCalls: number;
  readonly handoffs: number;
  readonly outputRetries: number;
  readonly usage?: ProviderUsage;
  readonly sessionId?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly trace: RunTrace;
}

/** One item yielded by `Runner.stream()`. */
export type RunStreamEvent<TOutput = string> =
  | EzAgentEventMap[keyof EzAgentEventMap]
  | {
      readonly type: "result";
      readonly result: RunResult<TOutput>;
    };

/** Resolved safety limits used internally for one run. */
export interface ResolvedRunLimits {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxHandoffs: number;
  readonly timeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly maxOutputRetries: number;
}
