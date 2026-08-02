import { z } from "zod";
import { describe, expect, it } from "vitest";

import { Agent, allow, block, GuardrailError, Runner, tool, ValidationError } from "../../src";
import type { ApprovalGuardrail, InputGuardrail, OutputGuardrail, ToolGuardrail } from "../../src";
import { assistantResponse, MockProvider } from "../mocks/MockProvider";

describe("guardrails, structured output, and runner streaming", () => {
  it("blocks unsafe input before a provider call and emits a guardrail event", async () => {
    const denySecrets: InputGuardrail = {
      check: ({ input }) =>
        typeof input === "string" && input.includes("secret")
          ? block("Secrets are not accepted as input.")
          : allow,
      name: "deny_secrets"
    };
    const provider = new MockProvider([assistantResponse("unreachable")]);
    const runner = new Runner({ generateRunId: () => "run_input_guardrail" });
    const phases: string[] = [];
    runner.on("guardrail", ({ phase }) => {
      phases.push(phase);
    });

    await expect(
      runner.run(
        new Agent({
          guardrails: { input: [denySecrets] },
          instructions: "Be safe.",
          model: "mock-model",
          name: "Safe Agent",
          provider
        }),
        { input: "my secret is 123" }
      )
    ).rejects.toBeInstanceOf(GuardrailError);

    expect(provider.requests).toHaveLength(0);
    expect(phases).toEqual(["input"]);
  });

  it("runs tool guardrails then returns approval blocks to the model as tool failures", async () => {
    let toolGuardrailCalls = 0;
    let executeCalls = 0;
    const fetchInvoice = tool({
      description: "Fetches an invoice by ID.",
      execute: ({ invoiceId }) => {
        executeCalls += 1;
        return { invoiceId };
      },
      name: "fetch_invoice",
      schema: z.object({ invoiceId: z.string() })
    });
    const observeTool: ToolGuardrail = {
      check: () => {
        toolGuardrailCalls += 1;
        return allow;
      },
      name: "observe_tool"
    };
    const requireApproval: ApprovalGuardrail = {
      check: () => block("Human approval is required for invoice access."),
      name: "invoice_approval"
    };
    const provider = new MockProvider([
      assistantResponse("", [
        {
          arguments: '{"invoiceId":"inv_1"}',
          id: "call_invoice",
          name: "fetch_invoice"
        }
      ]),
      assistantResponse("I need approval before accessing that invoice.")
    ]);
    const runner = new Runner({ generateRunId: () => "run_approval_guardrail" });
    const phases: string[] = [];
    runner.on("guardrail", ({ phase }) => {
      phases.push(phase);
    });

    const result = await runner.run(
      new Agent({
        guardrails: { approval: [requireApproval], tool: [observeTool] },
        instructions: "Use tools only when approved.",
        model: "mock-model",
        name: "Invoice Agent",
        provider,
        tools: [fetchInvoice]
      }),
      { input: "Fetch invoice inv_1" }
    );

    expect(toolGuardrailCalls).toBe(1);
    expect(executeCalls).toBe(0);
    expect(phases).toEqual(["approval"]);
    expect(result.output).toBe("I need approval before accessing that invoice.");
    expect(JSON.parse(String(provider.requests[1]?.messages[3]?.content))).toMatchObject({
      error: { code: "GUARDRAIL_ERROR" }
    });
  });

  it("blocks unsafe final output before completing a run", async () => {
    const denyLeak: OutputGuardrail = {
      check: ({ text }) => (text.includes("password") ? block("Sensitive output blocked.") : allow),
      name: "deny_sensitive_output"
    };
    const provider = new MockProvider([assistantResponse("The password is example")]);

    await expect(
      new Runner({ generateRunId: () => "run_output_guardrail" }).run(
        new Agent({
          guardrails: { output: [denyLeak] },
          instructions: "Be safe.",
          model: "mock-model",
          name: "Output Agent",
          provider
        }),
        { input: "Tell me a password" }
      )
    ).rejects.toBeInstanceOf(GuardrailError);
  });

  it("repairs invalid structured JSON and returns schema-typed output", async () => {
    const provider = new MockProvider([
      MockProvider.invalidOutput("This is not JSON"),
      MockProvider.text('{"answer":"Ranchi","confidence":0.9}')
    ]);
    const runner = new Runner({ generateRunId: () => "run_structured" });
    const retries: number[] = [];
    runner.on("retry", ({ attempt }) => {
      retries.push(attempt);
    });
    const agent = new Agent({
      instructions: "Return location data.",
      model: "mock-model",
      name: "Structured Agent",
      output: z.object({
        answer: z.string(),
        confidence: z.number().min(0).max(1)
      }),
      provider
    });

    const result = await runner.run(agent, { input: "What is Jharkhand's capital?" });

    expect(result.output.answer).toBe("Ranchi");
    expect(result.output.confidence).toBe(0.9);
    expect(result.text).toBe('{"answer":"Ranchi","confidence":0.9}');
    expect(retries).toEqual([1]);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.responseFormat).toMatchObject({
      name: "structured_agent_output",
      strict: true,
      type: "json_schema"
    });
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      content: expect.stringContaining("did not satisfy"),
      role: "user"
    });
  });

  it("fails gracefully when structured output exhausts its repair budget", async () => {
    const provider = new MockProvider([MockProvider.invalidOutput("still not JSON")]);

    await expect(
      new Runner({ generateRunId: () => "run_structured_failure", maxOutputRetries: 0 }).run(
        new Agent({
          instructions: "Return JSON.",
          model: "mock-model",
          name: "Failure Agent",
          output: z.object({ answer: z.string() }),
          provider
        }),
        { input: "Answer" }
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("streams token and tool lifecycle events through an async iterator", async () => {
    const lookup = tool({
      description: "Looks up a value.",
      execute: ({ key }) => ({ key, value: "found" }),
      name: "lookup",
      schema: z.object({ key: z.string() })
    });
    const provider = new MockProvider({
      stream: [
        [
          {
            model: "stream-model",
            provider: "stream",
            type: "response.start"
          },
          {
            provider: "stream",
            response: assistantResponse("", [
              { arguments: '{"key":"x"}', id: "call_lookup", name: "lookup" }
            ]),
            type: "response.completed"
          }
        ],
        [
          { delta: "streamed ", provider: "stream", type: "text.delta" },
          { delta: "answer", provider: "stream", type: "text.delta" },
          {
            provider: "stream",
            response: assistantResponse("streamed answer"),
            type: "response.completed"
          }
        ]
      ]
    });
    const runner = new Runner({ generateRunId: () => "run_stream" });
    const agent = new Agent({
      instructions: "Use lookup when needed.",
      model: "stream-model",
      name: "Streaming Agent",
      provider,
      tools: [lookup]
    });
    const eventTypes: string[] = [];
    let finalOutput: string | undefined;

    for await (const event of runner.stream(agent, { input: "Lookup x then answer." })) {
      eventTypes.push(event.type);
      if (event.type === "result") {
        finalOutput = event.result.output;
      }
    }

    expect(provider.streamRequests).toHaveLength(2);
    expect(eventTypes).toContain("token");
    expect(eventTypes).toContain("tool:start");
    expect(eventTypes).toContain("tool:end");
    expect(eventTypes.at(-1)).toBe("result");
    expect(finalOutput).toBe("streamed answer");
  });
});
