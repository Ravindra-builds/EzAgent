import type { output as ZodOutput, ZodType } from "zod";

import type { JsonSchema, ToolCall } from "../types";

/** Context supplied to a tool invocation by the Runner. */
export interface ToolExecutionContext<TContext = unknown> {
  readonly runId: string;
  readonly agentName: string;
  readonly toolCallId: string;
  readonly context: TContext;
  /** Aborts when the parent run is cancelled or the tool deadline expires. */
  readonly signal: AbortSignal;
}

/** A typed tool callback declared by an application developer. */
export type ToolExecute<TInput, TResult, TContext = unknown> = (
  input: TInput,
  context: ToolExecutionContext<TContext>
) => TResult | Promise<TResult>;

/** Configuration accepted by the `tool()` factory. */
export interface ToolConfig<
  TSchema extends ZodType = ZodType,
  TResult = unknown,
  TContext = unknown
> {
  readonly name: string;
  readonly description: string;
  /** A Zod object schema used for both provider parameters and runtime validation. */
  readonly schema: TSchema;
  readonly execute: ToolExecute<ZodOutput<TSchema>, TResult, TContext>;
  /** Optional per-invocation deadline in milliseconds. */
  readonly timeoutMs?: number;
}

/**
 * Immutable provider-facing tool metadata.
 *
 * Tool callbacks are intentionally private to the factory/executor boundary;
 * application code declares them through `tool({ execute })`, while only the
 * Runner's ToolExecutor can invoke validated arguments.
 */
export interface Tool<TInput = unknown, TResult = unknown, TContext = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: ZodType;
  readonly parameters: JsonSchema;
  readonly timeoutMs?: number;
  /**
   * Compile-time-only information retained by the factory return type.
   * It is intentionally absent at runtime; callbacks remain executor-only.
   */
  readonly __types?: {
    readonly input: TInput;
    readonly result: TResult;
    readonly context: TContext;
  };
}

/** Input passed to `ToolExecutor.execute`. */
export interface ToolExecutionOptions<TContext = unknown> {
  readonly runId: string;
  readonly agentName: string;
  readonly toolCall: ToolCall;
  readonly context: TContext;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** A successful, normalized tool invocation. */
export interface ToolExecutionResult {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly value: unknown;
  /** Content safe to append as a provider-neutral tool message. */
  readonly output: string;
  readonly durationMs: number;
}

/** Configuration for a reusable ToolExecutor. */
export interface ToolExecutorConfig {
  readonly defaultTimeoutMs?: number;
}
