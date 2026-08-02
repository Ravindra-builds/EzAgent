import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  Agent,
  allow,
  block,
  GuardrailError,
  handoff,
  InMemoryTraceExporter,
  middleware,
  plugin,
  ProviderError,
  Runner,
  tool,
  ValidationError
} from "../../src";
import type { InputGuardrail, OutputGuardrail } from "../../src";
import { MockProvider } from "../mocks/MockProvider";

describe("Runtime Failure Scenarios", () => {
  it("recovers when provider times out on first try but succeeds on retry", async () => {
    const provider = new MockProvider([
      MockProvider.error(new ProviderError("timeout", { provider: "mock", retryable: true })),
      MockProvider.text("success after retry")
    ]);
    const runner = new Runner({
      generateRunId: () => "provider_retry",
      retry: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 }
    });
    const agent = new Agent({ name: "A", provider, model: "mock", instructions: "..." });
    const result = await runner.run(agent, { input: "Go" });
    expect(result.output).toBe("success after retry");
    expect(provider.requests).toHaveLength(2);
  });

  it("fails completely when provider exhausts all retries", async () => {
    const provider = new MockProvider([
      MockProvider.error(new ProviderError("timeout 1", { provider: "mock", retryable: true })),
      MockProvider.error(new ProviderError("timeout 2", { provider: "mock", retryable: true }))
    ]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "provider_exhaust",
      retry: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      traceExporter: exporter
    });
    const agent = new Agent({ name: "A", provider, model: "mock", instructions: "..." });

    await expect(runner.run(agent, { input: "Go" })).rejects.toBeInstanceOf(ProviderError);

    const trace = exporter.get("provider_exhaust");
    expect(trace?.status).toBe("failed");
    expect(trace?.providerCalls).toHaveLength(2);
  });

  it("fails when invalid structured output exhausts repair budget", async () => {
    const provider = new MockProvider([
      MockProvider.invalidOutput('{"bad": 1}'),
      MockProvider.invalidOutput('{"bad": 2}')
    ]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "repair_exhaust",
      maxOutputRetries: 1,
      traceExporter: exporter
    });
    const agent = new Agent({
      name: "A",
      provider,
      model: "mock",
      output: z.object({ answer: z.string() }),
      instructions: "..."
    });

    await expect(runner.run(agent, { input: "Go" })).rejects.toBeInstanceOf(ValidationError);
    const trace = exporter.get("repair_exhaust");
    expect(trace?.status).toBe("failed");
    expect(provider.requests).toHaveLength(2);
  });

  it("fails and traces when input guardrail rejects", async () => {
    const inputGuard: InputGuardrail = {
      name: "bad_word",
      check: ({ input }) => (input === "bad" ? block("blocked input") : allow)
    };
    const provider = new MockProvider([]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({ generateRunId: () => "guard_reject", traceExporter: exporter });
    const agent = new Agent({
      name: "A",
      provider,
      model: "mock",
      guardrails: { input: [inputGuard] },
      instructions: "..."
    });

    await expect(runner.run(agent, { input: "bad" })).rejects.toBeInstanceOf(GuardrailError);
    const trace = exporter.get("guard_reject");
    expect(trace?.status).toBe("failed");
    expect(trace?.guardrails).toHaveLength(1);
    expect(trace?.guardrails[0]?.phase).toBe("input");
  });

  it("fails and traces when output guardrail rejects", async () => {
    const outGuard: OutputGuardrail = {
      name: "safe_out",
      check: ({ text }) => (text === "unsafe" ? block("unsafe output") : allow)
    };
    const provider = new MockProvider([MockProvider.text("unsafe")]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({ generateRunId: () => "guard_out", traceExporter: exporter });
    const agent = new Agent({
      name: "A",
      provider,
      model: "mock",
      guardrails: { output: [outGuard] },
      instructions: "..."
    });

    await expect(runner.run(agent, { input: "Go" })).rejects.toBeInstanceOf(GuardrailError);
    const trace = exporter.get("guard_out");
    expect(trace?.status).toBe("failed");
    expect(trace?.guardrails).toHaveLength(1);
    expect(trace?.guardrails[0]?.phase).toBe("output");
  });

  it("fails when max iterations are exceeded with tools present", async () => {
    const t = tool({
      name: "t",
      description: "t",
      schema: z.object({}),
      execute: async () => ({})
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([{ id: "c1", name: "t", arguments: "{}" }]),
      MockProvider.toolCalls([{ id: "c2", name: "t", arguments: "{}" }]),
      MockProvider.toolCalls([{ id: "c3", name: "t", arguments: "{}" }])
    ]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "max_iter",
      maxIterations: 2,
      traceExporter: exporter
    });
    const agent = new Agent({
      name: "A",
      provider,
      model: "mock",
      tools: [t],
      instructions: "..."
    });

    await expect(runner.run(agent, { input: "Go" })).rejects.toThrow(/iteration/i);
    const trace = exporter.get("max_iter");
    expect(trace?.tools).toHaveLength(2);
  });

  it("fails when max handoffs are exceeded and verify trace", async () => {
    const agentC = new Agent({
      name: "C",
      provider: new MockProvider([]),
      model: "mock",
      instructions: "..."
    });

    const provider2 = new MockProvider([
      MockProvider.toolCalls([{ id: "h2", name: "handoff_to_c", arguments: "{}" }])
    ]);
    const agentB = new Agent({
      name: "B",
      provider: provider2,
      model: "mock",
      instructions: "...",
      handoffs: [handoff(agentC)]
    });

    const provider1 = new MockProvider([
      MockProvider.toolCalls([{ id: "h1", name: "handoff_to_b", arguments: "{}" }])
    ]);
    const agentA = new Agent({
      name: "A",
      provider: provider1,
      model: "mock",
      instructions: "...",
      handoffs: [handoff(agentB)]
    });

    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "max_handoffs",
      maxHandoffs: 1,
      traceExporter: exporter
    });

    await expect(runner.run(agentA, { input: "Go" })).rejects.toThrow(/handoff/i);
    const trace = exporter.get("max_handoffs");
    expect(trace?.status).toBe("failed");
    expect(trace?.handoffs).toHaveLength(1);
  });

  it("calls first middleware onError when second middleware fails", async () => {
    let firstOnError = 0;
    const mid1 = middleware({
      name: "m1",
      onError: async () => {
        firstOnError++;
      }
    });
    const mid2 = middleware({
      name: "m2",
      before: async () => {
        throw new Error("m2 fail");
      }
    });
    const provider = new MockProvider([]);
    const runner = new Runner({ generateRunId: () => "mid_fail", middleware: [mid1, mid2] });
    const agent = new Agent({ name: "A", provider, model: "mock", instructions: "..." });

    await expect(runner.run(agent, { input: "Go" })).rejects.toThrow("m2 fail");
    expect(firstOnError).toBe(1);
  });

  it("isolates middleware onError hook failure to not mask real error", async () => {
    const mid1 = middleware({
      name: "m1",
      onError: async () => {
        throw new Error("onError fail");
      }
    });
    const mid2 = middleware({
      name: "m2",
      before: async () => {
        throw new Error("real error");
      }
    });
    const provider = new MockProvider([]);
    const runner = new Runner({
      generateRunId: () => "mid_onerror_fail",
      middleware: [mid1, mid2]
    });
    const agent = new Agent({ name: "A", provider, model: "mock", instructions: "..." });

    await expect(runner.run(agent, { input: "Go" })).rejects.toThrow("real error");
  });

  it("fails and traces when plugin middleware before-hook rejects", async () => {
    const p = plugin({
      name: "p",
      middleware: [
        middleware({
          name: "m",
          before: async () => {
            throw new Error("plugin before fail");
          }
        })
      ]
    });
    const provider = new MockProvider([MockProvider.text("success")]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({ generateRunId: () => "plugin_before", traceExporter: exporter });
    const agent = new Agent({ name: "A", provider, model: "mock", instructions: "..." }).use(p);

    await expect(runner.run(agent, { input: "Go" })).rejects.toThrow("plugin before fail");
    const trace = exporter.get("plugin_before");
    expect(trace?.status).toBe("failed");
    expect(trace?.middleware).toMatchObject([{ middleware: "m", phase: "before" }]);
  });

  it("recovers as tool error when tool times out", async () => {
    const slowTool = tool({
      name: "slow",
      description: "slow",
      schema: z.object({}),
      timeoutMs: 1,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return {};
      }
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([{ id: "c1", name: "slow", arguments: "{}" }]),
      MockProvider.text("fallback")
    ]);
    const runner = new Runner({ generateRunId: () => "tool_timeout" });
    const agent = new Agent({
      name: "A",
      provider,
      model: "mock",
      tools: [slowTool],
      instructions: "..."
    });

    const result = await runner.run(agent, { input: "Go" });
    expect(result.output).toBe("fallback");
    const msgs = provider.requests[1]?.messages;
    expect(msgs?.at(-1)?.content).toContain("TIMEOUT");
  });

  it("cancels via external AbortSignal during execution", async () => {
    const slowTool = tool({
      name: "slow",
      description: "slow",
      schema: z.object({}),
      execute: async (_args, { signal }) => {
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) return reject(new Error("aborted"));
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([{ id: "c1", name: "slow", arguments: "{}" }])
    ]);
    const runner = new Runner({ generateRunId: () => "tool_abort" });
    const agent = new Agent({
      name: "A",
      provider,
      model: "mock",
      tools: [slowTool],
      instructions: "..."
    });

    const controller = new AbortController();
    const p = runner.run(agent, { input: "Go", signal: controller.signal });

    controller.abort();

    await expect(p).rejects.toThrow();
  });
});
