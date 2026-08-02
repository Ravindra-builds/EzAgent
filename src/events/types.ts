import type { GuardrailPhase } from "../guardrails/types";
import type { ProviderResponse, ProviderUsage, ToolCall } from "../types";

/** Common metadata included with every runtime event. */
export interface RunEventBase {
  readonly runId: string;
  readonly agentName: string;
  readonly timestamp: string;
}

/** Emitted when a runner initializes a new run. */
export interface RunStartedEvent extends RunEventBase {
  readonly type: "run:start";
  readonly model: string;
  readonly sessionId?: string;
}

/** Emitted after a persisted conversation transcript has been hydrated. */
export interface SessionLoadedEvent extends RunEventBase {
  readonly type: "session:loaded";
  readonly sessionId: string;
  readonly messageCount: number;
}

/** Emitted after a successful final result has been persisted as a session. */
export interface SessionSavedEvent extends RunEventBase {
  readonly type: "session:saved";
  readonly sessionId: string;
  readonly messageCount: number;
}

/** Emitted after factual long-term memory has been retrieved for a run. */
export interface MemoryLoadedEvent extends RunEventBase {
  readonly type: "memory:loaded";
  readonly query: string;
  readonly memoryIds: readonly string[];
}

/** Emitted immediately before a provider chat or stream attempt. */
export interface ModelStartedEvent extends RunEventBase {
  readonly type: "model:start";
  readonly iteration: number;
  readonly attempt: number;
  readonly provider: string;
  readonly model: string;
  readonly messageCount: number;
  readonly streaming: boolean;
}

/** Emitted after a provider response is normalized successfully. */
export interface ModelCompletedEvent extends RunEventBase {
  readonly type: "model:end";
  readonly iteration: number;
  readonly attempt: number;
  readonly provider: string;
  readonly durationMs: number;
  readonly response: ProviderResponse;
}

/** Emitted when a provider attempt fails. */
export interface ModelFailedEvent extends RunEventBase {
  readonly type: "model:error";
  readonly iteration: number;
  readonly attempt: number;
  readonly provider: string;
  readonly durationMs: number;
  readonly error: Error;
}

/** Emitted for every normalized provider text delta during Runner streaming. */
export interface TokenEvent extends RunEventBase {
  readonly type: "token";
  readonly iteration: number;
  readonly provider: string;
  readonly delta: string;
}

/** Emitted immediately before a model-requested tool is validated and invoked. */
export interface ToolStartedEvent extends RunEventBase {
  readonly type: "tool:start";
  readonly iteration: number;
  readonly toolName: string;
  readonly toolCall: ToolCall;
}

/** Emitted after a tool returns a serializable result. */
export interface ToolCompletedEvent extends RunEventBase {
  readonly type: "tool:end";
  readonly iteration: number;
  readonly toolName: string;
  readonly toolCall: ToolCall;
  readonly durationMs: number;
  readonly output: string;
}

/** Emitted when a tool is unknown, invalid, cancelled, times out, or throws. */
export interface ToolFailedEvent extends RunEventBase {
  readonly type: "tool:error";
  readonly iteration: number;
  readonly toolName: string;
  readonly toolCall: ToolCall;
  readonly durationMs: number;
  readonly error: Error;
}

/** Emitted before Runner switches to a target Agent. */
export interface HandoffStartedEvent extends RunEventBase {
  readonly type: "handoff:start";
  readonly iteration: number;
  readonly handoffName: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly toolCall: ToolCall;
}

/** Emitted after context is preserved and the target Agent becomes active. */
export interface HandoffCompletedEvent extends RunEventBase {
  readonly type: "handoff:end";
  readonly iteration: number;
  readonly handoffName: string;
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly toolCall: ToolCall;
}

/** Emitted whenever a composed guardrail blocks a runtime action. */
export interface GuardrailEvent extends RunEventBase {
  readonly type: "guardrail";
  readonly phase: GuardrailPhase;
  readonly guardrail: string;
  readonly reason: string;
  readonly iteration?: number;
  readonly toolCallId?: string;
  readonly toolName?: string;
}

/** Emitted when output repair or a retryable provider attempt is scheduled. */
export interface RetryEvent extends RunEventBase {
  readonly type: "retry";
  readonly reason: "provider" | "structured_output";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs?: number;
  readonly provider?: string;
}

/** Emitted around lifecycle middleware hooks. */
export interface MiddlewareStartedEvent extends RunEventBase {
  readonly type: "middleware:start";
  readonly middleware: string;
  readonly phase: "before" | "after" | "error";
}

export interface MiddlewareCompletedEvent extends RunEventBase {
  readonly type: "middleware:end";
  readonly middleware: string;
  readonly phase: "before" | "after" | "error";
  readonly durationMs: number;
}

export interface MiddlewareFailedEvent extends RunEventBase {
  readonly type: "middleware:error";
  readonly middleware: string;
  readonly phase: "before" | "after" | "error";
  readonly durationMs: number;
  readonly error: Error;
}

/** Emitted after an immutable trace has been finalized. */
export interface TraceCompletedEvent extends RunEventBase {
  readonly type: "trace:completed";
  readonly status: "completed" | "failed";
}

/** Emitted after a model returns the final assistant response. */
export interface RunCompletedEvent extends RunEventBase {
  readonly type: "completed";
  readonly finalAgentName: string;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly handoffs: number;
  readonly outputRetries: number;
  readonly durationMs: number;
  readonly output: unknown;
  readonly text: string;
  readonly usage?: ProviderUsage;
  readonly sessionId?: string;
}

/** Emitted exactly once when a run terminates with an error. */
export interface RunFailedEvent extends RunEventBase {
  readonly type: "failed";
  readonly iterations: number;
  readonly toolCalls: number;
  readonly handoffs: number;
  readonly durationMs: number;
  readonly error: Error;
  readonly sessionId?: string;
}

/** Event payloads emitted by Runner through milestones 2–6. */
export interface EzAgentEventMap {
  readonly "run:start": RunStartedEvent;
  readonly "session:loaded": SessionLoadedEvent;
  readonly "session:saved": SessionSavedEvent;
  readonly "memory:loaded": MemoryLoadedEvent;
  readonly "model:start": ModelStartedEvent;
  readonly "model:end": ModelCompletedEvent;
  readonly "model:error": ModelFailedEvent;
  readonly token: TokenEvent;
  readonly "tool:start": ToolStartedEvent;
  readonly "tool:end": ToolCompletedEvent;
  readonly "tool:error": ToolFailedEvent;
  readonly "handoff:start": HandoffStartedEvent;
  readonly "handoff:end": HandoffCompletedEvent;
  readonly guardrail: GuardrailEvent;
  readonly retry: RetryEvent;
  readonly "middleware:start": MiddlewareStartedEvent;
  readonly "middleware:end": MiddlewareCompletedEvent;
  readonly "middleware:error": MiddlewareFailedEvent;
  readonly "trace:completed": TraceCompletedEvent;
  readonly completed: RunCompletedEvent;
  readonly failed: RunFailedEvent;
}

/** A listener can be synchronous or asynchronous; listener failures never stop a run. */
export type EventListener<TEvent> = (event: TEvent) => void | Promise<void>;
