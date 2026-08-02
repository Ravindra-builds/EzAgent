import { EzAgentError } from "../errors";
import type { ProviderChatRequest, ProviderResponse, ToolCall } from "../types";
import { deepFreeze, safeErrorMessage } from "../utils";
import type {
  GuardrailTrace,
  HandoffTrace,
  MiddlewareTrace,
  ProviderTrace,
  RetryTrace,
  RunTrace,
  ToolTrace,
  TraceError
} from "./types";

/** Mutable collector used internally for exactly one active run. */
export class TraceCollector {
  private readonly providerCalls: ProviderTrace[] = [];
  private readonly tools: ToolTrace[] = [];
  private readonly handoffs: HandoffTrace[] = [];
  private readonly guardrails: GuardrailTrace[] = [];
  private readonly retries: RetryTrace[] = [];
  private readonly middleware: MiddlewareTrace[] = [];

  constructor(
    readonly runId: string,
    readonly initialAgentName: string,
    readonly startedAt: string,
    readonly sessionId: string | undefined
  ) {}

  providerStarted(input: {
    readonly attempt: number;
    readonly iteration: number;
    readonly agentName: string;
    readonly provider: string;
    readonly model: string;
    readonly streaming: boolean;
    readonly request: ProviderChatRequest;
    readonly startedAt: string;
  }): number {
    this.providerCalls.push(
      deepFreeze({
        ...input,
        request: cloneProviderRequest(input.request)
      }) as ProviderTrace
    );
    return this.providerCalls.length - 1;
  }

  providerCompleted(
    index: number,
    response: ProviderResponse,
    completedAt: string,
    durationMs: number
  ): void {
    const current = this.providerCalls[index];
    if (current === undefined) {
      return;
    }
    this.providerCalls[index] = deepFreeze({
      ...current,
      completedAt,
      durationMs,
      response: cloneProviderResponse(response)
    }) as ProviderTrace;
  }

  providerFailed(index: number, error: unknown, completedAt: string, durationMs: number): void {
    const current = this.providerCalls[index];
    if (current === undefined) {
      return;
    }
    this.providerCalls[index] = deepFreeze({
      ...current,
      completedAt,
      durationMs,
      error: traceError(error)
    }) as ProviderTrace;
  }

  toolStarted(input: {
    readonly iteration: number;
    readonly agentName: string;
    readonly toolCall: ToolCall;
    readonly startedAt: string;
  }): number {
    this.tools.push(
      deepFreeze({ ...input, toolCall: Object.freeze({ ...input.toolCall }) }) as ToolTrace
    );
    return this.tools.length - 1;
  }

  toolCompleted(index: number, output: string, completedAt: string, durationMs: number): void {
    const current = this.tools[index];
    if (current === undefined) {
      return;
    }
    this.tools[index] = deepFreeze({ ...current, completedAt, durationMs, output }) as ToolTrace;
  }

  toolFailed(index: number, error: unknown, completedAt: string, durationMs: number): void {
    const current = this.tools[index];
    if (current === undefined) {
      return;
    }
    this.tools[index] = deepFreeze({
      ...current,
      completedAt,
      durationMs,
      error: traceError(error)
    }) as ToolTrace;
  }

  handoff(trace: HandoffTrace): void {
    this.handoffs.push(
      deepFreeze({ ...trace, toolCall: Object.freeze({ ...trace.toolCall }) }) as HandoffTrace
    );
  }

  guardrail(trace: GuardrailTrace): void {
    this.guardrails.push(deepFreeze({ ...trace }) as GuardrailTrace);
  }

  retry(trace: RetryTrace): void {
    this.retries.push(deepFreeze({ ...trace }) as RetryTrace);
  }

  middlewareHook(trace: MiddlewareTrace): void {
    this.middleware.push(deepFreeze({ ...trace }) as MiddlewareTrace);
  }

  complete(input: {
    readonly finalAgentName: string;
    readonly completedAt: string;
    readonly durationMs: number;
    readonly output: unknown;
    readonly text: string;
  }): RunTrace {
    return deepFreeze({
      finalAgentName: input.finalAgentName,
      finalOutput: input.output,
      finalText: input.text,
      handoffs: Object.freeze([...this.handoffs]),
      guardrails: Object.freeze([...this.guardrails]),
      initialAgentName: this.initialAgentName,
      middleware: Object.freeze([...this.middleware]),
      providerCalls: Object.freeze([...this.providerCalls]),
      retries: Object.freeze([...this.retries]),
      runId: this.runId,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      startedAt: this.startedAt,
      status: "completed",
      tools: Object.freeze([...this.tools]),
      completedAt: input.completedAt,
      durationMs: input.durationMs
    }) as RunTrace;
  }

  fail(error: unknown, completedAt: string, durationMs: number): RunTrace {
    return deepFreeze({
      error: traceError(error),
      handoffs: Object.freeze([...this.handoffs]),
      guardrails: Object.freeze([...this.guardrails]),
      initialAgentName: this.initialAgentName,
      middleware: Object.freeze([...this.middleware]),
      providerCalls: Object.freeze([...this.providerCalls]),
      retries: Object.freeze([...this.retries]),
      runId: this.runId,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
      startedAt: this.startedAt,
      status: "failed",
      tools: Object.freeze([...this.tools]),
      completedAt,
      durationMs
    }) as RunTrace;
  }
}

/** Converts an error into trace-safe diagnostic data. */
export function traceError(error: unknown): TraceError {
  const code = error instanceof EzAgentError ? error.code : undefined;
  return Object.freeze({
    name: error instanceof Error ? error.name : "Error",
    message: safeErrorMessage(error),
    ...(code === undefined ? {} : { code })
  });
}

function cloneProviderRequest(request: ProviderChatRequest): ProviderChatRequest {
  return deepFreeze({
    ...request,
    messages: Object.freeze([...request.messages]),
    ...(request.tools === undefined ? {} : { tools: Object.freeze([...request.tools]) }),
    ...(request.stopSequences === undefined
      ? {}
      : { stopSequences: Object.freeze([...request.stopSequences]) })
  }) as ProviderChatRequest;
}

function cloneProviderResponse(response: ProviderResponse): ProviderResponse {
  return deepFreeze({ ...response }) as ProviderResponse;
}
