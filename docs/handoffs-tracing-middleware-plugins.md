# Handoffs, retries, tracing, middleware, and plugins

Milestone 6 adds delegation, operational reliability, lifecycle extension points, and exportable traces without introducing an external agent framework.

## Handoffs

A handoff exposes a target Agent to the current model as a provider tool:

```ts
import { Agent, handoff, Runner } from "ezagent";

const billing = new Agent({
  name: "Billing",
  instructions: "Handle invoices, refunds, and payment questions.",
  model: "gpt-4.1-mini",
  provider
});

const router = new Agent({
  name: "Support Router",
  instructions: "Delegate specialist questions when needed.",
  model: "gpt-4.1-mini",
  provider,
  handoffs: [
    handoff(billing, {
      description: "Delegate billing, refunds, payment, and invoice questions."
    })
  ]
});

const result = await new Runner({ maxHandoffs: 3 }).run(router, {
  input: "My invoice has an unexpected charge."
});
```

When the model invokes a handoff tool, Runner:

1. records the assistant handoff call in the transcript;
2. appends a tool acknowledgment and a target-agent system instruction;
3. switches the active provider/model/tools/guardrails/output schema to the target Agent;
4. retains the full previous context;
5. emits `handoff:start` and `handoff:end`.

Handoffs default to a maximum of five per run. Runner also rejects a target whose agent name has already appeared in the current handoff path, preventing delegation loops. `RunResult.agentName` remains the initial agent; `RunResult.finalAgentName` identifies the final specialist.

## Provider retries

Runner retries retryable `ProviderError` failures for non-streaming provider calls:

```ts
const runner = new Runner({
  retry: {
    maxAttempts: 3, // includes the initial call
    initialDelayMs: 250,
    maxDelayMs: 2_000,
    jitter: true
  }
});
```

The default policy retries `ProviderError` values whose `retryable` property is true. Supply `shouldRetry(error, attempt)` to customize it. Each scheduled retry emits `retry` with `reason: "provider"` and is recorded in the trace.

Runner deliberately does not replay a provider stream after it has begun emitting visible tokens; replaying can duplicate user-visible text. Streaming errors surface normally instead.

## Tracing

Every run receives an immutable `RunTrace` available on its result:

```ts
const result = await runner.run(agent, { input: "Hello" });
console.log(result.trace.providerCalls);
console.log(result.trace.tools);
console.log(result.trace.handoffs);
console.log(result.trace.guardrails);
```

A trace includes run timing/status, provider prompts and normalized responses, provider attempts/errors, tool calls/results/errors, handoffs, guardrails, retries, middleware lifecycle observations, final output, and terminal error data.

Use an exporter for application-owned persistence:

```ts
import { InMemoryTraceExporter, Runner } from "ezagent";

const exporter = new InMemoryTraceExporter();
const runner = new Runner({ traceExporter: exporter });

await runner.run(agent, { input: "Hello" });
const trace = exporter.get("run_id");
```

Exporter failures are isolated from the run. `Runner.getTrace(runId)` and `Runner.listTraces()` provide local access to finalized traces.

## Lifecycle middleware

Middleware is deliberately small and framework independent:

```ts
import { middleware, Runner } from "ezagent";

const authentication = middleware({
  name: "authentication",
  before: ({ metadata }) => {
    if (metadata.userId === undefined) {
      throw new Error("Authentication is required.");
    }
  }
});

const runner = new Runner({ middleware: [authentication] });
await runner.run(agent, {
  input: "Hello",
  metadata: { userId: "user_123" }
});
```

- `before` hooks run in declaration order and may block a run by throwing.
- `after` hooks run in reverse order after successful core execution.
- `onError` hooks run in reverse order after failure; their own errors are isolated so they cannot hide the original failure.
- Runner emits `middleware:start`, `middleware:end`, and `middleware:error`.

## Plugins

Plugins are immutable middleware contributions. `Agent.use()` returns a new Agent rather than mutating the existing one:

```ts
import { middleware, plugin } from "ezagent";

const auditPlugin = plugin({
  name: "audit",
  middleware: [
    middleware({
      name: "audit_log",
      before: ({ runId }) => console.log(`Starting ${runId}`)
    })
  ]
});

const auditedAgent = agent.use(auditPlugin);
```

Runner middleware runs first. Agent plugin middleware then runs in plugin order. If a handoff activates a target Agent with plugin middleware, that target's previously unseen middleware joins the active lifecycle pipeline before the next provider call.
