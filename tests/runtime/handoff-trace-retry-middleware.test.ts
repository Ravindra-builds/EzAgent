import { describe, expect, it } from "vitest";

import {
  Agent,
  handoff,
  HandoffError,
  InMemoryTraceExporter,
  middleware,
  plugin,
  ProviderError,
  Runner
} from "../../src";
import { assistantResponse, MockProvider } from "../mocks/MockProvider";

describe("handoffs, retries, middleware, and traces", () => {
  it("preserves transcript context across a handoff and records the delegation trace", async () => {
    const billingProvider = new MockProvider([
      assistantResponse("Your billing specialist can help.")
    ]);
    const billing = new Agent({
      instructions: "Handle billing questions accurately.",
      model: "billing-model",
      name: "Billing",
      provider: billingProvider
    });
    const routerProvider = new MockProvider([
      assistantResponse("", [
        {
          arguments: '{"reason":"billing question"}',
          id: "call_billing",
          name: "handoff_to_billing"
        }
      ])
    ]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "run_handoff",
      traceExporter: exporter
    });
    const handoffEvents: string[] = [];
    runner.on("handoff:start", ({ type }) => {
      handoffEvents.push(type);
    });
    runner.on("handoff:end", ({ type }) => {
      handoffEvents.push(type);
    });

    const result = await runner.run(
      new Agent({
        handoffs: [handoff(billing)],
        instructions: "Route billing questions to Billing.",
        model: "router-model",
        name: "Router",
        provider: routerProvider
      }),
      { input: "I have a question about an invoice." }
    );

    expect(result.agentName).toBe("Router");
    expect(result.finalAgentName).toBe("Billing");
    expect(result.handoffs).toBe(1);
    expect(result.output).toBe("Your billing specialist can help.");
    expect(handoffEvents).toEqual(["handoff:start", "handoff:end"]);
    expect(billingProvider.requests[0]?.messages).toMatchObject([
      { role: "system" },
      { role: "user", content: "I have a question about an invoice." },
      { role: "assistant" },
      { role: "tool", name: "handoff_to_billing" },
      { role: "system", content: expect.stringContaining("You are now Billing") }
    ]);
    expect(result.trace.handoffs).toMatchObject([
      { fromAgent: "Router", handoffName: "Billing", toAgent: "Billing" }
    ]);
    expect(exporter.get("run_handoff")).toEqual(result.trace);
  });

  it("prevents cycles when a target tries to hand off to an already visited agent name", async () => {
    const routerBase = new Agent({
      instructions: "Route requests.",
      model: "router-model",
      name: "Router",
      provider: new MockProvider([])
    });
    const billingProvider = new MockProvider([
      assistantResponse("", [
        {
          arguments: "{}",
          id: "call_router",
          name: "handoff_to_router"
        }
      ])
    ]);
    const billing = new Agent({
      handoffs: [handoff(routerBase)],
      instructions: "Handle billing.",
      model: "billing-model",
      name: "Billing",
      provider: billingProvider
    });
    const routerProvider = new MockProvider([
      assistantResponse("", [
        {
          arguments: "{}",
          id: "call_billing",
          name: "handoff_to_billing"
        }
      ])
    ]);
    const router = routerBase.withHandoffs([handoff(billing)]);
    const runner = new Runner({ generateRunId: () => "run_handoff_loop" });

    // RouterBase uses its original provider; replace through a fresh equivalent Agent with target handoff.
    const routable = new Agent({
      handoffs: [handoff(billing)],
      instructions: router.instructions,
      model: router.model,
      name: router.name,
      provider: routerProvider
    });

    await expect(runner.run(routable, { input: "Loop" })).rejects.toBeInstanceOf(HandoffError);
    expect(billingProvider.requests).toHaveLength(1);
  });

  it("retries retryable provider failures and records each provider attempt", async () => {
    const provider = new MockProvider([
      MockProvider.error(
        new ProviderError("Temporary upstream failure", {
          provider: "mock",
          retryable: true
        })
      ),
      MockProvider.text("Recovered response")
    ]);
    const runner = new Runner({
      generateRunId: () => "run_retry",
      retry: {
        initialDelayMs: 0,
        maxAttempts: 2,
        maxDelayMs: 0
      }
    });
    const retries: Array<{ attempt: number; reason: string }> = [];
    runner.on("retry", ({ attempt, reason }) => {
      retries.push({ attempt, reason });
    });

    const result = await runner.run(
      new Agent({
        instructions: "Answer normally.",
        model: "mock-model",
        name: "Retry Agent",
        provider
      }),
      { input: "Hello" }
    );

    expect(result.output).toBe("Recovered response");
    expect(provider.requests).toHaveLength(2);
    expect(retries).toEqual([{ attempt: 2, reason: "provider" }]);
    expect(result.trace.providerCalls).toHaveLength(2);
    expect(result.trace.providerCalls[0]?.error?.code).toBe("PROVIDER_ERROR");
    expect(result.trace.retries).toMatchObject([{ reason: "provider", attempt: 2 }]);
  });

  it("composes Runner middleware with immutable Agent plugin middleware", async () => {
    const calls: string[] = [];
    const global = middleware({
      after: () => {
        calls.push("global:after");
      },
      before: () => {
        calls.push("global:before");
      },
      name: "global"
    });
    const auditPlugin = plugin({
      middleware: [
        middleware({
          after: () => {
            calls.push("plugin:after");
          },
          before: () => {
            calls.push("plugin:before");
          },
          name: "audit"
        })
      ],
      name: "audit_plugin"
    });
    const base = new Agent({
      instructions: "Answer normally.",
      model: "mock-model",
      name: "Plugin Agent",
      provider: new MockProvider([assistantResponse("ok")])
    });
    const runner = new Runner({
      generateRunId: () => "run_plugin",
      middleware: [global]
    });

    const result = await runner.run(base.use(auditPlugin), { input: "Hello" });

    expect(result.output).toBe("ok");
    expect(base.plugins).toHaveLength(0);
    expect(calls).toEqual(["global:before", "plugin:before", "plugin:after", "global:after"]);
    expect(
      result.trace.middleware.map(({ middleware: name, phase }) => `${name}:${phase}`)
    ).toEqual(["global:before", "audit:before", "audit:after", "global:after"]);
  });

  it("finalizes failed traces and keeps them available through Runner.getTrace", async () => {
    const provider = new MockProvider([
      MockProvider.error(
        new ProviderError("Permanent provider failure", {
          provider: "mock",
          retryable: false
        })
      )
    ]);
    const runner = new Runner({ generateRunId: () => "run_failed_trace" });

    await expect(
      runner.run(
        new Agent({
          instructions: "Answer normally.",
          model: "mock-model",
          name: "Failure Agent",
          provider
        }),
        { input: "Hello" }
      )
    ).rejects.toBeInstanceOf(ProviderError);

    expect(runner.getTrace("run_failed_trace")).toMatchObject({
      error: { code: "PROVIDER_ERROR" },
      status: "failed"
    });
  });
});
