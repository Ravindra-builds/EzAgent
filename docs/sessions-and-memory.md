# Sessions, storage, and long-term memory

Milestone 4 separates two concepts that should not be conflated:

- **Sessions** are persisted conversation transcripts.
- **Memory** is an optional store of durable factual records.

## Sessions

Attach a storage adapter to Runner, then pass a stable `sessionId` to each related run:

```ts
import { FileStorage, Runner } from "ezagent";

const runner = new Runner({
  storage: new FileStorage({ directory: ".ezagent/sessions" })
});

await runner.run(agent, {
  sessionId: "customer_123",
  sessionMetadata: { customerId: "customer_123" },
  input: "Hello"
});

const next = await runner.run(agent, {
  sessionId: "customer_123",
  input: "What did we discuss?"
});
```

Runner loads the previous transcript, appends the new user input, and saves the full transcript only after a successful final result. It emits `session:loaded` and `session:saved` events. Failed, blocked, cancelled, or timed-out runs do not overwrite the stored session.

A persisted `Session` contains:

```ts
interface Session {
  sessionId: string;
  messages: readonly ChatMessage[];
  metadata: Readonly<Record<string, JsonValue>>;
  createdAt: string;
  updatedAt: string;
}
```

## Storage adapters

```ts
interface StorageAdapter {
  saveSession(session: Session): Promise<void>;
  loadSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<boolean>;
}
```

Available adapters:

| Adapter           | Use case                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| `InMemoryStorage` | Tests, examples, and process-local prototypes                           |
| `FileStorage`     | Node.js local persistence with encoded filenames and atomic JSON writes |

`FileStorage` is intentionally a small local adapter, not a substitute for transactional multi-process database storage. Redis, SQLite, and database adapters can implement the same interface later.

## Long-term factual memory

Facts are saved explicitly; EzAgent does **not** automatically turn conversations into long-term memory.

```ts
import { Agent, InMemoryMemory } from "ezagent";

const memory = new InMemoryMemory();
await memory.save({
  namespace: "customer_123",
  content: "Customer prefers concise Hindi replies."
});

const agent = new Agent({
  name: "Support Agent",
  instructions: "Be helpful and use relevant customer preferences.",
  model: "gpt-4.1-mini",
  provider,
  memory: {
    adapter: memory,
    namespace: "customer_123",
    limit: 5
  }
});
```

Before each run, Runner searches the configured adapter using the input text and inserts matching facts as an **ephemeral** system prompt. The facts are not appended to, or saved in, the conversation transcript. This prevents stale memory context from accumulating across every session turn.

Override or disable retrieval per run:

```ts
await runner.run(agent, {
  input: "How should you respond to me?",
  memory: { query: "customer language preference", limit: 3 }
});

await runner.run(agent, {
  input: "Ignore stored preferences for this task.",
  memory: false
});
```

## Memory adapter contract

```ts
interface MemoryAdapter {
  save(input: MemorySaveInput): Promise<MemoryRecord>;
  search(query: string, options?: MemorySearchOptions): Promise<readonly MemorySearchResult[]>;
  delete(id: string): Promise<boolean>;
}
```

`InMemoryMemory` uses deterministic lexical matching and namespace filtering. It is deliberately transparent rather than claiming semantic/vector behavior. Future Redis, SQLite, and vector adapters can provide more advanced retrieval without changing the Agent or Runner API.

Runner emits `memory:loaded` with the query and selected record IDs. Memory content itself stays out of events unless your application already owns the adapter/results.
