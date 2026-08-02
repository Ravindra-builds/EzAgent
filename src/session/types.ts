import type { ChatMessage, JsonValue } from "../types";

/** Persistent conversation history for a single logical session. */
export interface Session {
  readonly sessionId: string;
  readonly messages: readonly ChatMessage[];
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input used to construct or normalize a persistent Session. */
export interface SessionInput {
  readonly sessionId: string;
  readonly messages: readonly ChatMessage[];
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}
