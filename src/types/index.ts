/** Runtime list of provider-neutral chat roles. */
export const CHAT_MESSAGE_ROLES = Object.freeze(["system", "user", "assistant", "tool"] as const);

export type { JsonArray, JsonObject, JsonPrimitive, JsonSchema, JsonValue } from "./json";
export type {
  AssistantMessage,
  ChatMessage,
  ContentPart,
  ImageUrlContentPart,
  MessageContent,
  MessageRole,
  SystemMessage,
  TextContentPart,
  ToolCall,
  ToolMessage,
  UserMessage
} from "./messages";
export type {
  Provider,
  ProviderCallOptions,
  ProviderCapabilities,
  ProviderChatRequest,
  ProviderFinishReason,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderToolDefinition,
  ProviderUsage,
  ResponseFormat,
  StreamToolCall,
  ToolCallDelta,
  ToolChoice
} from "./provider";
