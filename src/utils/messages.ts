import type { ChatMessage, ContentPart, JsonValue, MessageContent, ToolCall } from "../types";
import { deepFreeze } from "./deep-freeze";

/** Clones and freezes provider-neutral message content. */
export function freezeMessageContent(content: MessageContent): MessageContent {
  if (typeof content === "string") {
    return content;
  }

  return Object.freeze(content.map((part) => Object.freeze({ ...part }) as ContentPart));
}

/** Clones and freezes a provider-neutral message before crossing a runtime boundary. */
export function freezeChatMessage(message: ChatMessage): ChatMessage {
  const common = {
    content: freezeMessageContent(message.content),
    ...(message.metadata === undefined ? {} : { metadata: freezeMetadata(message.metadata) }),
    ...(message.name === undefined ? {} : { name: message.name })
  };

  switch (message.role) {
    case "system":
      return Object.freeze({ ...common, role: "system" });
    case "user":
      return Object.freeze({ ...common, role: "user" });
    case "assistant":
      return Object.freeze({
        ...common,
        role: "assistant",
        ...(message.toolCalls === undefined
          ? {}
          : { toolCalls: freezeToolCalls(message.toolCalls) })
      });
    case "tool":
      return Object.freeze({
        ...common,
        name: message.name,
        role: "tool",
        toolCallId: message.toolCallId
      });
  }
}

/** Returns text suitable for a prompt from a text or multipart message. */
export function messageContentToText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => (part.type === "text" ? part.text : part.imageUrl)).join("");
}

function freezeMetadata(
  metadata: Readonly<Record<string, JsonValue>>
): Readonly<Record<string, JsonValue>> {
  return deepFreeze({ ...metadata });
}

function freezeToolCalls(calls: readonly ToolCall[]): readonly ToolCall[] {
  return Object.freeze(calls.map((call) => Object.freeze({ ...call })));
}
