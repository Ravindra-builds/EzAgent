import type { JsonValue } from "../types";

/** A durable factual memory record, distinct from a conversation transcript. */
export interface MemoryRecord {
  readonly id: string;
  readonly content: string;
  readonly namespace?: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input for creating or replacing a factual memory record. */
export interface MemorySaveInput {
  readonly id?: string;
  readonly content: string;
  readonly namespace?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** A ranked memory match returned by search. */
export interface MemorySearchResult {
  readonly memory: MemoryRecord;
  readonly score: number;
}

/** Search controls shared by memory adapters. */
export interface MemorySearchOptions {
  readonly namespace?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

/** Provider-neutral persistence/retrieval boundary for long-term facts. */
export interface MemoryAdapter {
  save(input: MemorySaveInput): Promise<MemoryRecord>;
  search(query: string, options?: MemorySearchOptions): Promise<readonly MemorySearchResult[]>;
  delete(id: string): Promise<boolean>;
}

/** Construction options for the deterministic in-memory adapter. */
export interface InMemoryMemoryConfig {
  readonly initialMemories?: readonly MemoryRecord[];
  readonly generateId?: () => string;
  readonly now?: () => Date;
}
