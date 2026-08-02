# Tools and runtime events

Milestones 3–7 provide Zod-backed tools, a typed framework-independent event bus, runner-level streaming, handoff/retry/middleware events, and a full testable SDK release surface.

## Define a tool

```ts
import { z } from "zod";
import { tool } from "ezagent";

const lookupWeather = tool({
  name: "lookup_weather",
  description: "Gets current weather for a named city.",
  schema: z.object({
    city: z.string().min(1),
    unit: z.enum(["celsius", "fahrenheit"]).default("celsius")
  }),
  timeoutMs: 5_000,
  execute: async ({ city, unit }, context) => {
    // `city` and `unit` are inferred from the Zod schema.
    // context.signal is aborted on cancellation or timeout.
    return { city, unit, temperature: 27 };
  }
});
```

The `schema` must be a Zod object schema. EzAgent converts it to JSON Schema for providers and retains the Zod schema for runtime validation. The `execute` callback receives inferred input and a context with `runId`, `agentName`, `toolCallId`, caller context, and an `AbortSignal`.

## Tool execution behavior

For every model-requested tool call, `ToolExecutor`:

1. Parses the model's raw JSON argument string.
2. Validates it with `schema.safeParse()`.
3. Invokes the registered callback with a linked cancellation signal.
4. Enforces the tool-specific or runner default timeout.
5. Serializes a successful result for the provider-neutral tool message.

Malformed JSON, Zod failures, unknown tool names, non-serializable returns, cancellations, and callback exceptions are represented by useful `ToolError`/`TimeoutError` values. During a `Runner` loop those failures are serialized as a safe error tool message rather than crashing the process, giving the model one chance to repair its call within normal limits.

## Subscribe to events

```ts
const runner = new Runner();

const unsubscribe = runner.on("tool:start", ({ runId, toolName }) => {
  console.log(`[${runId}] starting ${toolName}`);
});

runner.on("tool:end", ({ durationMs, output, toolName }) => {
  console.log(`${toolName} completed in ${durationMs}ms: ${output}`);
});

runner.on("failed", ({ error }) => {
  console.error(error.code, error.message);
});

// Stop observing when no longer needed.
unsubscribe();
```

Runner emits the following events today:

| Event                                                      | When it fires                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `run:start`                                                | A run has initialized its isolated state                           |
| `session:loaded` / `session:saved`                         | Persistent conversation history was hydrated or saved              |
| `memory:loaded`                                            | Factual long-term memory was retrieved for the prompt              |
| `model:start`                                              | Immediately before a provider chat or stream call                  |
| `model:end` / `model:error`                                | A normalized provider response completed or failed                 |
| `token`                                                    | A normalized text delta arrives during `Runner.stream()`           |
| `tool:start` / `tool:end` / `tool:error`                   | Tool lifecycle transitions                                         |
| `handoff:start` / `handoff:end`                            | An active agent delegates to a target specialist                   |
| `guardrail`                                                | An input, output, tool, or approval guardrail blocked work         |
| `retry`                                                    | Structured-output repair or a retryable provider call is scheduled |
| `middleware:start` / `middleware:end` / `middleware:error` | Lifecycle middleware hook observations                             |
| `trace:completed`                                          | An immutable completed or failed trace was finalized               |
| `completed` / `failed`                                     | The run returned a final result or terminated with an error        |

Use `Runner.stream()` when application code needs the same lifecycle as an async iterator; it yields these events plus a final typed `result` item.

## EventBus behavior

`EventBus` supports `on`, `once`, `off`, `clear`, and `listenerCount`. Event listener failures are isolated: a throwing or rejected listener cannot crash or alter an agent run. Pass `new EventBus({ onListenerError })` to a Runner when your application needs to record observer failures.
