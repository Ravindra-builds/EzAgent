# Guardrails, structured output, and streaming

Milestone 5 adds composable runtime safety checks, Zod-validated final output, and Runner-level async-iterator streaming.

## Guardrails

Guardrails are named callbacks grouped by runtime phase:

```ts
import {
  Agent,
  allow,
  block,
  type ApprovalGuardrail,
  type InputGuardrail,
  type OutputGuardrail,
  type ToolGuardrail
} from "ezagent";

const denySecrets: InputGuardrail = {
  name: "deny_secrets",
  check: ({ input }) =>
    typeof input === "string" && input.includes("api_key")
      ? block("Secrets are not accepted.")
      : allow
};

const requireApproval: ApprovalGuardrail = {
  name: "refund_approval",
  check: ({ tool }) =>
    tool.name === "issue_refund" ? block("A human must approve refunds.") : allow
};

const agent = new Agent({
  name: "Support Agent",
  instructions: "Help customers safely.",
  model: "gpt-4.1-mini",
  provider,
  guardrails: {
    input: [denySecrets],
    output: [],
    tool: [],
    approval: [requireApproval]
  }
});
```

| Phase      | Timing                                                       | Block behavior                                    |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `input`    | Before session loading, memory retrieval, and provider calls | Run fails with `GuardrailError`                   |
| `output`   | For a candidate final assistant response                     | Run fails with `GuardrailError`                   |
| `tool`     | Before tool argument validation/execution                    | A safe tool-error result is returned to the model |
| `approval` | After tool guardrails, before tool execution                 | A safe tool-error result is returned to the model |

Guardrails in each array run sequentially in declaration order and stop on the first `block(...)` decision. A blocked operation emits the `guardrail` event with phase, guardrail name, and reason. Throwing guardrail callbacks are not silently ignored; they fail the run so safety failures remain visible.

## Structured output

Pass a Zod object schema as `Agent.output`:

```ts
import { z } from "zod";

const agent = new Agent({
  name: "Location Agent",
  instructions: "Return a factual location answer.",
  model: "gpt-4.1-mini",
  provider,
  output: z.object({
    answer: z.string(),
    confidence: z.number().min(0).max(1)
  })
});

const result = await runner.run(agent, { input: "What is Jharkhand's capital?" });

result.output.answer; // string
result.output.confidence; // number
result.text; // raw final model text
```

EzAgent converts the schema to provider JSON Schema, asks the model for strict JSON output, parses the final text, and validates it with `safeParse`.

If the response is invalid JSON or violates the schema, Runner appends a concise correction instruction and retries the model up to `maxOutputRetries` (default: `2`). Each repair emits `retry` with `reason: "structured_output"`. Once the budget is exhausted, the run rejects with `ValidationError` containing sanitized issue paths/codes—not raw model output.

## Runner-level streaming

`Runner.stream()` uses an async iterator. It executes the same bounded loop as `run()`, including sessions, memory, guardrails, tools, structured-output repair, timeouts, and cancellation.

```ts
for await (const event of runner.stream(agent, { input: "Summarize this." })) {
  switch (event.type) {
    case "token":
      process.stdout.write(event.delta);
      break;
    case "tool:start":
      console.log(`\nCalling ${event.toolName}…`);
      break;
    case "result":
      console.log("\nFinal value:", event.result.output);
      break;
  }
}
```

The iterator yields normal runtime events (`run:start`, model/tool/session/memory/guardrail/retry events, `completed`, and `failed`) plus a final `result` event containing the typed `RunResult`. Exiting the iterator early aborts the underlying run.

Provider adapters still expose lower-level `Provider.stream()` methods. Prefer `Runner.stream()` for agent applications because it preserves tool execution, limits, guardrails, session persistence, and final structured-output validation.
