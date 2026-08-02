import { MemoryError, ValidationError } from "../errors";
import type { JsonValue } from "../types";
import { deepFreeze, isRecord } from "../utils";
import type {
  InMemoryMemoryConfig,
  MemoryAdapter,
  MemoryRecord,
  MemorySaveInput,
  MemorySearchOptions,
  MemorySearchResult
} from "./types";

/**
 * A deterministic lexical-memory adapter for tests, local prototypes, and small facts.
 *
 * It intentionally does not pretend to be a vector database. Future adapters can
 * implement semantic/vector retrieval behind the same MemoryAdapter contract.
 */
export class InMemoryMemory implements MemoryAdapter {
  private readonly memories = new Map<string, MemoryRecord>();
  private readonly generateId: () => string;
  private readonly now: () => Date;

  constructor(config: InMemoryMemoryConfig = {}) {
    if (typeof config !== "object" || config === null) {
      throw new ValidationError("InMemoryMemory configuration must be an object.");
    }
    if (config.generateId !== undefined && typeof config.generateId !== "function") {
      throw new ValidationError("InMemoryMemory generateId must be a function.", {
        metadata: { field: "generateId" }
      });
    }
    if (config.now !== undefined && typeof config.now !== "function") {
      throw new ValidationError("InMemoryMemory now must be a function.", {
        metadata: { field: "now" }
      });
    }

    this.generateId = config.generateId ?? defaultMemoryId;
    this.now = config.now ?? (() => new Date());
    for (const memory of config.initialMemories ?? []) {
      const normalized = normalizeRecord(memory);
      this.memories.set(normalized.id, normalized);
    }
  }

  async save(input: MemorySaveInput): Promise<MemoryRecord> {
    validateSaveInput(input);
    const id = input.id ?? this.generateId();
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new MemoryError("Memory ID generator must return a non-empty string.");
    }

    const current = this.memories.get(id);
    const timestamp = this.now().toISOString();
    const memory = createMemoryRecord({
      content: input.content,
      createdAt: current?.createdAt ?? timestamp,
      id,
      metadata: input.metadata ?? current?.metadata ?? {},
      ...(input.namespace === undefined
        ? current?.namespace === undefined
          ? {}
          : { namespace: current.namespace }
        : { namespace: input.namespace }),
      updatedAt: timestamp
    });
    this.memories.set(id, memory);
    return cloneMemory(memory);
  }

  async search(
    query: string,
    options: MemorySearchOptions = {}
  ): Promise<readonly MemorySearchResult[]> {
    if (typeof query !== "string") {
      throw new ValidationError("Memory search query must be a string.", {
        metadata: { field: "query" }
      });
    }
    validateSearchOptions(options);
    if (options.signal?.aborted === true) {
      throw new MemoryError("Memory search was aborted.", { metadata: { phase: "search" } });
    }

    const terms = tokenize(query);
    if (terms.size === 0) {
      return Object.freeze([]);
    }

    const limit = options.limit ?? 5;
    const results: MemorySearchResult[] = [];
    for (const memory of this.memories.values()) {
      if (options.namespace !== undefined && memory.namespace !== options.namespace) {
        continue;
      }
      const score = lexicalScore(terms, memory.content);
      if (score > 0) {
        results.push(
          Object.freeze({
            memory: cloneMemory(memory),
            score
          })
        );
      }
    }

    results.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.memory.updatedAt !== right.memory.updatedAt) {
        return right.memory.updatedAt.localeCompare(left.memory.updatedAt);
      }
      return left.memory.id.localeCompare(right.memory.id);
    });

    return Object.freeze(results.slice(0, limit));
  }

  async delete(id: string): Promise<boolean> {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new ValidationError("Memory ID must be a non-empty string.", {
        metadata: { field: "id" }
      });
    }

    return this.memories.delete(id);
  }
}

function validateSaveInput(input: MemorySaveInput): void {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("Memory save input must be an object.");
  }
  if (typeof input.content !== "string" || input.content.trim().length === 0) {
    throw new ValidationError("Memory content must be a non-empty string.", {
      metadata: { field: "content" }
    });
  }
  if (input.id !== undefined && (typeof input.id !== "string" || input.id.trim().length === 0)) {
    throw new ValidationError("Memory ID must be a non-empty string when provided.", {
      metadata: { field: "id" }
    });
  }
  if (
    input.namespace !== undefined &&
    (typeof input.namespace !== "string" || input.namespace.trim().length === 0)
  ) {
    throw new ValidationError("Memory namespace must be a non-empty string when provided.", {
      metadata: { field: "namespace" }
    });
  }
  if (input.metadata !== undefined && !isJsonRecord(input.metadata)) {
    throw new ValidationError("Memory metadata must contain only JSON values.", {
      metadata: { field: "metadata" }
    });
  }
}

function validateSearchOptions(options: MemorySearchOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new ValidationError("Memory search options must be an object.");
  }
  if (
    options.namespace !== undefined &&
    (typeof options.namespace !== "string" || options.namespace.trim().length === 0)
  ) {
    throw new ValidationError("Memory search namespace must be a non-empty string.", {
      metadata: { field: "namespace" }
    });
  }
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit <= 0)) {
    throw new ValidationError("Memory search limit must be a positive integer.", {
      metadata: { field: "limit" }
    });
  }
}

function normalizeRecord(record: MemoryRecord): MemoryRecord {
  return createMemoryRecord(record);
}

function createMemoryRecord(input: {
  readonly id: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly namespace?: string;
}): MemoryRecord {
  if (
    typeof input.id !== "string" ||
    input.id.trim().length === 0 ||
    typeof input.content !== "string" ||
    input.content.trim().length === 0 ||
    (input.namespace !== undefined &&
      (typeof input.namespace !== "string" || input.namespace.trim().length === 0)) ||
    Number.isNaN(Date.parse(input.createdAt)) ||
    Number.isNaN(Date.parse(input.updatedAt)) ||
    !isJsonRecord(input.metadata)
  ) {
    throw new ValidationError("Memory record is invalid.");
  }

  return Object.freeze({
    content: input.content,
    createdAt: input.createdAt,
    id: input.id,
    metadata: deepFreeze({ ...input.metadata }),
    ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
    updatedAt: input.updatedAt
  });
}

function cloneMemory(memory: MemoryRecord): MemoryRecord {
  return createMemoryRecord(memory);
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function lexicalScore(queryTerms: ReadonlySet<string>, content: string): number {
  const contentTerms = tokenize(content);
  let matches = 0;
  for (const term of queryTerms) {
    if (contentTerms.has(term)) {
      matches += 1;
    }
  }

  return matches / queryTerms.size;
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

function defaultMemoryId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `memory_${globalThis.crypto.randomUUID()}`;
  }

  return `memory_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
