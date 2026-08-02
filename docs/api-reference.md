# API reference

This page summarizes every public EzAgent module. Use the linked guides for behavior, recipes, and failure semantics.

## Core runtime

| Export                               | Purpose                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Agent<TOutput>`                     | Immutable configuration for a provider, tools, handoffs, memory, guardrails, output schema, and plugins |
| `Agent.use(plugin)`                  | Returns a new Agent with an immutable plugin contribution                                               |
| `Agent.withHandoffs(handoffs)`       | Returns a new Agent with replacement handoff targets                                                    |
| `Runner`                             | Executes bounded `run()` or async-iterator `stream()` loops                                             |
| `Runner.on()` / `events`             | Subscribes to typed runtime events                                                                      |
| `Runner.getTrace()` / `listTraces()` | Reads finalized immutable traces held by that Runner                                                    |
| `RunOptions<T>`                      | Input, context, session, memory, limits, retry, metadata, and abort controls                            |
| `RunResult<T>`                       | Final output, raw text, transcript, counters, timing, handoff identity, and trace                       |
| `RunStreamEvent<T>`                  | Runtime event or final `{ type: "result", result }` item from `Runner.stream()`                         |
| `RunnerConfig`                       | Default limits, storage, middleware, retry policy, trace exporter, event bus, and tool executor         |
| `CHAT_MESSAGE_ROLES`                 | Runtime list of `system`, `user`, `assistant`, and `tool` roles                                         |

## Providers

| Export                | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `Provider`            | Provider-neutral `chat()` / `stream()` contract        |
| `OpenAIProvider`      | Direct OpenAI Chat Completions adapter                 |
| `GeminiProvider`      | Direct Gemini Generative Language adapter              |
| `FetchImplementation` | Injectable transport type for tests or custom runtimes |

## Tools and handoffs

| Export                                       | Purpose                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `tool()`                                     | Creates a Zod-validated provider-visible callable tool           |
| `ToolExecutor`                               | Validates, invokes, times out, aborts, and serializes tool calls |
| `Tool`, `ToolConfig`, `ToolExecutionContext` | Tool metadata and typing contracts                               |
| `handoff()`                                  | Creates a model-visible target-Agent delegation                  |
| `Handoff`, `HandoffConfig`                   | Handoff metadata contracts                                       |

## Sessions, storage, and memory

| Export                                          | Purpose                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `Session`, `SessionInput`                       | Immutable conversation transcript contracts                            |
| `createSession`, `cloneSession`, `parseSession` | Session creation, cloning, and persisted-data validation helpers       |
| `StorageAdapter`                                | `saveSession`, `loadSession`, and `deleteSession` persistence boundary |
| `InMemoryStorage`                               | Process-local deterministic session storage                            |
| `FileStorage`                                   | Atomic Node.js JSON-file session storage                               |
| `MemoryAdapter`                                 | Factual long-term memory contract                                      |
| `InMemoryMemory`                                | Lexical, namespaced in-memory factual retrieval                        |
| `MemorySaveInput`, `MemorySearchOptions`        | Memory persistence and retrieval controls                              |

## Guardrails and structured output

| Export                                                                    | Purpose                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| `allow`, `block`, `guardrail()`                                           | Named guardrail decisions and factory                  |
| `evaluateGuardrails()`                                                    | Sequential guardrail evaluator for custom integrations |
| `InputGuardrail`, `OutputGuardrail`, `ToolGuardrail`, `ApprovalGuardrail` | Phase-specific guardrail types                         |
| `Agent.output`                                                            | Zod object schema for typed final output               |
| `createStructuredOutput`, `parseStructuredOutput`                         | Advanced schema metadata and validation helpers        |
| `createStructuredOutputRepairPrompt`, `zodToJsonSchema`                   | Advanced output repair and provider-schema utilities   |

## Retries, traces, middleware, and plugins

| Export                                                   | Purpose                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `RetryPolicy`                                            | Provider retry attempts, backoff, jitter, and custom retry predicate |
| `RunTrace`, `ProviderTrace`, `ToolTrace`, `HandoffTrace` | Immutable observability data contracts                               |
| `TraceExporter`, `InMemoryTraceExporter`                 | Terminal trace export boundary and local collector                   |
| `middleware()`                                           | Named lifecycle middleware factory                                   |
| `RunnerMiddleware`, `MiddlewareContext`                  | Middleware hook contracts                                            |
| `plugin()`                                               | Immutable Agent middleware contribution factory                      |
| `AgentPlugin`                                            | Plugin metadata contract                                             |

## Events

`EventBus<EzAgentEventMap>` supports `on`, `once`, `off`, `clear`, and `listenerCount`.

Runner event names include:

```text
run:start
session:loaded / session:saved
memory:loaded
model:start / model:end / model:error
token
tool:start / tool:end / tool:error
handoff:start / handoff:end
guardrail
retry
middleware:start / middleware:end / middleware:error
trace:completed
completed / failed
```

## Errors

All intentional errors extend `EzAgentError` and have a stable `code`.

| Code                           | Class                        | Meaning                                                     |
| ------------------------------ | ---------------------------- | ----------------------------------------------------------- |
| `AGENT_ERROR`                  | `AgentError`                 | Invalid runtime state, cancellation, or safety boundary     |
| `PROVIDER_CONFIGURATION_ERROR` | `ProviderConfigurationError` | Invalid provider setup or transport                         |
| `PROVIDER_ERROR`               | `ProviderError`              | Provider HTTP, transport, or decoding failure               |
| `TOOL_ERROR`                   | `ToolError`                  | Tool parse, validation, execution, or serialization failure |
| `VALIDATION_ERROR`             | `ValidationError`            | Invalid configuration, schema, or output                    |
| `TIMEOUT_ERROR`                | `TimeoutError`               | Run or tool deadline exceeded                               |
| `HANDOFF_ERROR`                | `HandoffError`               | Invalid handoff, loop, or handoff limit                     |
| `GUARDRAIL_ERROR`              | `GuardrailError`             | Input or final-output guardrail block                       |
| `STORAGE_ERROR`                | `StorageError`               | Session persistence failure                                 |
| `MEMORY_ERROR`                 | `MemoryError`                | Memory adapter failure                                      |

See the relevant guide from the [documentation index](README.md) for full examples.
