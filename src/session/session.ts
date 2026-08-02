import { ValidationError } from "../errors";
import type { ChatMessage, ContentPart, JsonValue, MessageContent, ToolCall } from "../types";
import { deepFreeze, freezeChatMessage, isRecord } from "../utils";
import type { Session, SessionInput } from "./types";

/** Validates, clones, and freezes a session before storage or runtime use. */
export function createSession(input: SessionInput): Session {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("Session must be an object.");
  }
  if (typeof input.sessionId !== "string" || input.sessionId.trim().length === 0) {
    throw new ValidationError("Session sessionId must be a non-empty string.", {
      metadata: { field: "sessionId" }
    });
  }
  if (!Array.isArray(input.messages) || !input.messages.every(isChatMessage)) {
    throw new ValidationError("Session messages must be valid provider-neutral messages.", {
      metadata: { field: "messages", sessionId: input.sessionId }
    });
  }
  if (!isIsoTimestamp(input.createdAt) || !isIsoTimestamp(input.updatedAt)) {
    throw new ValidationError("Session timestamps must be valid ISO date strings.", {
      metadata: { sessionId: input.sessionId }
    });
  }
  if (input.metadata !== undefined && !isJsonRecord(input.metadata)) {
    throw new ValidationError("Session metadata must contain only JSON values.", {
      metadata: { field: "metadata", sessionId: input.sessionId }
    });
  }

  return Object.freeze({
    createdAt: input.createdAt,
    messages: Object.freeze(input.messages.map((message) => freezeChatMessage(message))),
    metadata: deepFreeze({ ...(input.metadata ?? {}) }),
    sessionId: input.sessionId,
    updatedAt: input.updatedAt
  });
}

/** Creates a deep immutable copy of an existing session. */
export function cloneSession(session: Session): Session {
  return createSession(session);
}

/** Narrows an untrusted persisted object to a validated Session. */
export function parseSession(value: unknown): Session {
  if (!isRecord(value)) {
    throw new ValidationError("Stored session data must be an object.");
  }

  return createSession({
    createdAt: value.createdAt as string,
    messages: value.messages as readonly ChatMessage[],
    ...(value.metadata === undefined
      ? {}
      : { metadata: value.metadata as Readonly<Record<string, JsonValue>> }),
    sessionId: value.sessionId as string,
    updatedAt: value.updatedAt as string
  });
}

/** Checks whether a message has the shape required for session persistence. */
export function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value) || !isMessageContent(value.content)) {
    return false;
  }
  if (value.metadata !== undefined && !isJsonRecord(value.metadata)) {
    return false;
  }
  if (value.name !== undefined && typeof value.name !== "string") {
    return false;
  }

  switch (value.role) {
    case "system":
    case "user":
      return true;
    case "assistant":
      return (
        value.toolCalls === undefined ||
        (Array.isArray(value.toolCalls) && value.toolCalls.every(isToolCall))
      );
    case "tool":
      return typeof value.name === "string" && typeof value.toolCallId === "string";
    default:
      return false;
  }
}

function isMessageContent(value: unknown): value is MessageContent {
  if (typeof value === "string") {
    return true;
  }
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every(isContentPart);
}

function isContentPart(value: unknown): value is ContentPart {
  if (!isRecord(value)) {
    return false;
  }
  if (value.type === "text") {
    return typeof value.text === "string";
  }
  if (value.type === "image_url") {
    return (
      typeof value.imageUrl === "string" &&
      (value.mediaType === undefined || typeof value.mediaType === "string")
    );
  }
  return false;
}

function isToolCall(value: unknown): value is ToolCall {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.arguments === "string"
  );
}

function isJsonRecord(value: unknown): value is Readonly<Record<string, JsonValue>> {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonRecord(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
