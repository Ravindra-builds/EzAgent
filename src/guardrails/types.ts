import type { AssistantMessage, MessageContent, ToolCall } from "../types";
import type { Tool } from "../tools";

/** The runtime stage at which a guardrail is evaluated. */
export type GuardrailPhase = "input" | "output" | "tool" | "approval";

/** Allows a guarded operation to continue. */
export interface GuardrailAllow {
  readonly action: "allow";
}

/** Blocks a guarded operation with a developer-facing reason. */
export interface GuardrailBlock {
  readonly action: "block";
  readonly reason: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Decision returned by every guardrail callback. */
export type GuardrailDecision = GuardrailAllow | GuardrailBlock;

/** Common context available to every guardrail. */
export interface GuardrailContextBase<TContext = unknown> {
  readonly runId: string;
  readonly agentName: string;
  readonly context: TContext | undefined;
  readonly signal: AbortSignal;
}

/** Context passed to input guardrails before provider calls or memory retrieval. */
export interface InputGuardrailContext<TContext = unknown> extends GuardrailContextBase<TContext> {
  readonly input: MessageContent;
  readonly sessionId?: string;
}

/** Context passed to output guardrails for every candidate final assistant response. */
export interface OutputGuardrailContext<TContext = unknown> extends GuardrailContextBase<TContext> {
  readonly message: AssistantMessage;
  readonly text: string;
}

/** Context passed to tool guardrails before argument validation/execution. */
export interface ToolGuardrailContext<TContext = unknown> extends GuardrailContextBase<TContext> {
  readonly tool: Tool;
  readonly toolCall: ToolCall;
}

/** Context passed to approval guardrails before a tool receives authorization. */
export interface ApprovalGuardrailContext<
  TContext = unknown
> extends GuardrailContextBase<TContext> {
  readonly tool: Tool;
  readonly toolCall: ToolCall;
}

/** A named asynchronous/synchronous guardrail callback. */
export interface Guardrail<TGuardrailContext> {
  readonly name: string;
  check(context: TGuardrailContext): GuardrailDecision | Promise<GuardrailDecision>;
}

export type InputGuardrail<TContext = unknown> = Guardrail<InputGuardrailContext<TContext>>;
export type OutputGuardrail<TContext = unknown> = Guardrail<OutputGuardrailContext<TContext>>;
export type ToolGuardrail<TContext = unknown> = Guardrail<ToolGuardrailContext<TContext>>;
export type ApprovalGuardrail<TContext = unknown> = Guardrail<ApprovalGuardrailContext<TContext>>;

/** Immutable grouped guardrails configured on an Agent. */
export interface AgentGuardrails {
  readonly input?: readonly InputGuardrail[];
  readonly output?: readonly OutputGuardrail[];
  readonly tool?: readonly ToolGuardrail[];
  readonly approval?: readonly ApprovalGuardrail[];
}

/** The first blocking decision returned by a composed guardrail pipeline. */
export interface GuardrailBlockResult<TGuardrail> {
  readonly guardrail: TGuardrail;
  readonly decision: GuardrailBlock;
}
