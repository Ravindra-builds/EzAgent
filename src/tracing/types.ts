import type { ProviderChatRequest, ProviderResponse, ToolCall } from "../types";

/** Sanitized error representation persisted in a trace. */
export interface TraceError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

/** One provider attempt, including its normalized prompt/request and response/error. */
export interface ProviderTrace {
  readonly attempt: number;
  readonly iteration: number;
  readonly agentName: string;
  readonly provider: string;
  readonly model: string;
  readonly streaming: boolean;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly request: ProviderChatRequest;
  readonly response?: ProviderResponse;
  readonly error?: TraceError;
}

/** One requested tool execution or tool-level failure. */
export interface ToolTrace {
  readonly iteration: number;
  readonly agentName: string;
  readonly toolCall: ToolCall;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly output?: string;
  readonly error?: TraceError;
}

/** One agent delegation transition. */
export interface HandoffTrace {
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly handoffName: string;
  readonly toolCall: ToolCall;
  readonly timestamp: string;
}

/** A blocked safety policy decision. */
export interface GuardrailTrace {
  readonly phase: "input" | "output" | "tool" | "approval";
  readonly guardrail: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly toolCallId?: string;
}

/** An output or provider retry decision. */
export interface RetryTrace {
  readonly reason: "provider" | "structured_output";
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly timestamp: string;
  readonly delayMs?: number;
  readonly provider?: string;
}

/** A middleware lifecycle hook observation. */
export interface MiddlewareTrace {
  readonly middleware: string;
  readonly phase: "before" | "after" | "error";
  readonly timestamp: string;
  readonly error?: TraceError;
}

/** Complete immutable record of one EzAgent run. */
export interface RunTrace {
  readonly runId: string;
  readonly initialAgentName: string;
  readonly finalAgentName?: string;
  readonly sessionId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly status: "completed" | "failed";
  readonly providerCalls: readonly ProviderTrace[];
  readonly tools: readonly ToolTrace[];
  readonly handoffs: readonly HandoffTrace[];
  readonly guardrails: readonly GuardrailTrace[];
  readonly retries: readonly RetryTrace[];
  readonly middleware: readonly MiddlewareTrace[];
  readonly finalOutput?: unknown;
  readonly finalText?: string;
  readonly error?: TraceError;
}

/** Receives completed or failed traces without affecting the runtime result. */
export interface TraceExporter {
  export(trace: RunTrace): void | Promise<void>;
}
