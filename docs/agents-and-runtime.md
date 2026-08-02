# Agents and the runtime loop

Milestone 2 adds an immutable `Agent` and the original EzAgent `Runner`. Neither uses or wraps an external agent framework.

## Define an agent

```ts
import { Agent, OpenAIProvider } from "ezagent";

const agent = new Agent({
  name: "Support Assistant",
  instructions: "Answer product questions accurately. Escalate uncertainty.",
  model: "gpt-4.1-mini",
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  modelSettings: {
    temperature: 0.2,
    maxOutputTokens: 500
  }
});
```

`Agent` is configuration only. It validates its input once, copies and freezes the tool list and model settings, and exposes no execution method. A configured agent contains:

| Field           | Purpose                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `name`          | Stable human-readable identifier used in events and errors                         |
| `instructions`  | A required system instruction inserted at the start of every new run               |
| `model`         | Provider model identifier                                                          |
| `provider`      | Any implementation of EzAgent's `Provider` interface                               |
| `tools`         | Optional immutable tools created by `tool()`                                       |
| `modelSettings` | Optional temperature, top-p, output-token, stop-sequence, and tool-choice controls |
| `memory`        | Optional factual-memory adapter, namespace, and retrieval limit                    |
| `guardrails`    | Optional input, output, tool, and approval safety pipelines                        |
| `output`        | Optional Zod object schema for validated typed final output                        |

## Run an agent

```ts
import { Runner } from "ezagent";

const runner = new Runner({
  maxIterations: 10,
  maxToolCalls: 25,
  timeoutMs: 120_000,
  toolTimeoutMs: 30_000
});

const result = await runner.run(agent, {
  input: "How do I reset my password?",
  context: { customerId: "cust_123" },
  signal: abortController.signal
});

console.log(result.output);
```

`RunResult` contains a generated `runId`, immutable conversation transcript, final provider response/message, aggregate token usage when providers report it, iteration and tool-call counts, and timing fields.

## Runtime algorithm

For each `run`, Runner creates isolated state and runs this bounded loop:

1. Validate input guardrails, hydrate an optional session, and retrieve optional factual memory.
2. Build a provider-neutral request from the agent configuration and transcript.
3. Call `provider.chat()` or consume `provider.stream()` through `Runner.stream()`.
4. Append the normalized assistant message.
5. If the response has tool calls, apply tool/approval guardrails, validate and execute each one, append tool messages, then continue.
6. For a final response, apply output guardrails and validate/repair structured output when configured.
7. Persist a successful session, emit `completed`, and return `RunResult`.

The loop rejects safely when it reaches the iteration/tool-call limit, the run deadline, caller cancellation, or an unrecoverable provider failure. A tool failure is different: it becomes a structured tool-result error message so the model can correct its request on the next turn.

## Limits and cancellation

Defaults are intentionally bounded:

| Limit                     | Default     |
| ------------------------- | ----------- |
| Provider turns            | 10          |
| Attempted tool calls      | 25          |
| Structured-output repairs | 2           |
| Whole-run timeout         | 120 seconds |
| Per-tool timeout          | 30 seconds  |

Limits can be set when constructing `Runner` and tightened per call through `RunOptions`. The `AbortSignal` supplied to `run()` is propagated to provider calls and tools. Runner also races uncooperative promises against its deadline, so a provider or tool that ignores the signal cannot make the run wait indefinitely.

## Current scope

Runner supports both `run()` and async-iterator `stream()` execution. Sessions, factual memory, guardrails, structured-output repair, provider retries, handoffs, traces, lifecycle middleware, and immutable Agent plugins are integrated into the same bounded core loop. See the [sessions and memory guide](sessions-and-memory.md), [guardrails/output/streaming guide](guardrails-output-streaming.md), and [handoffs/tracing/middleware/plugins guide](handoffs-tracing-middleware-plugins.md).
