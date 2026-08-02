import type { JsonSchema, JsonValue } from "./json";
import type { AssistantMessage, ChatMessage, ToolCall } from "./messages";

/** A function exposed to a model by a provider adapter. */
export interface ProviderToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly parameters: JsonSchema;
  readonly strict?: boolean;
}

/** Controls whether a model may request tools. */
export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | {
      readonly type: "tool";
      readonly name: string;
    };

/** A provider-neutral response formatting request. */
export type ResponseFormat =
  | { readonly type: "text" }
  | { readonly type: "json_object" }
  | {
      readonly type: "json_schema";
      readonly name: string;
      readonly schema: JsonSchema;
      readonly strict?: boolean;
    };

/** Input sent to a provider's chat or stream operation. */
export interface ProviderChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ProviderToolDefinition[];
  readonly toolChoice?: ToolChoice;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxOutputTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly responseFormat?: ResponseFormat;
  /** Opaque application context. Adapters never transmit this field to an LLM. */
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Per-call controls that are safe for the runtime to pass to an adapter. */
export interface ProviderCallOptions {
  readonly signal?: AbortSignal;
  readonly requestId?: string;
}

/** Token usage reported by a provider, when available. */
export interface ProviderUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
}

/** Provider-neutral terminal reasons. */
export type ProviderFinishReason = "stop" | "tool_calls" | "length" | "content_filter" | "other";

/** A normalized result of a non-streaming provider call. */
export interface ProviderResponse {
  readonly provider: string;
  readonly model: string;
  readonly message: AssistantMessage;
  readonly finishReason: ProviderFinishReason;
  readonly id?: string;
  readonly usage?: ProviderUsage;
}

/** A partial model tool invocation emitted during streaming. */
export interface ToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsDelta?: string;
}

/** Events yielded by a provider's streaming operation. */
export type ProviderStreamEvent =
  | {
      readonly type: "response.start";
      readonly provider: string;
      readonly model: string;
    }
  | {
      readonly type: "text.delta";
      readonly provider: string;
      readonly delta: string;
    }
  | {
      readonly type: "tool-call.delta";
      readonly provider: string;
      readonly toolCall: ToolCallDelta;
    }
  | {
      readonly type: "response.completed";
      readonly provider: string;
      readonly response: ProviderResponse;
    };

/** Features advertised by a provider adapter. */
export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly imageInput: boolean;
}

/**
 * The only interface the EzAgent runtime needs to know about an LLM provider.
 *
 * Provider implementations own protocol translation and authentication. The
 * runtime only works with the provider-neutral types in this module.
 */
export interface Provider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ProviderChatRequest, options?: ProviderCallOptions): Promise<ProviderResponse>;
  stream(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): AsyncIterable<ProviderStreamEvent>;
}

/** A complete, normalized tool call retained for stream assembly. */
export type StreamToolCall = ToolCall;
