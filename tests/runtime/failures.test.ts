import { z } from "zod";
import { describe, expect, it } from "vitest";

import { Agent, handoff, HandoffError, middleware, plugin, Runner, tool } from "../../src";
import { assistantResponse, MockProvider } from "../mocks/MockProvider";

describe("runtime failure handling", () => {
  it("converts a thrown tool exception into a safe tool result so the model can recover", async () => {
    const failingTool = tool({
      description: "Always throws for test coverage.",
      execute: () => {
        throw new Error("upstream tool exploded");
      },
      name: "failing_tool",
      schema: z.object({})
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([{ arguments: "{}", id: "call_fail", name: "failing_tool" }]),
      MockProvider.text("I could not complete that tool request.")
    ]);

    const result = await new Runner({ generateRunId: () => "tool_throw" }).run(
      new Agent({
        instructions: "Use the tool when requested.",
        model: "mock-model",
        name: "Tool Throw Agent",
        provider,
        tools: [failingTool]
      }),
      { input: "Run the failing tool." }
    );

    expect(result.output).toBe("I could not complete that tool request.");
    expect(JSON.parse(String(provider.requests[1]?.messages.at(-1)?.content))).toMatchObject({
      error: { code: "TOOL_ERROR" }
    });
  });

  it("fails gracefully when the handoff limit is exceeded", async () => {
    const specialistProvider = new MockProvider([
      MockProvider.toolCalls([
        { arguments: "{}", id: "call_second", name: "handoff_to_escalation" }
      ])
    ]);
    const escalation = new Agent({
      instructions: "Handle escalations.",
      model: "mock-model",
      name: "Escalation",
      provider: new MockProvider([])
    });
    const specialist = new Agent({
      handoffs: [handoff(escalation)],
      instructions: "Handle specialist work.",
      model: "mock-model",
      name: "Specialist",
      provider: specialistProvider
    });
    const routerProvider = new MockProvider([
      MockProvider.toolCalls([{ arguments: "{}", id: "call_first", name: "handoff_to_specialist" }])
    ]);
    const runner = new Runner({
      generateRunId: () => "handoff_limit",
      maxHandoffs: 1
    });

    await expect(
      runner.run(
        new Agent({
          handoffs: [handoff(specialist)],
          instructions: "Delegate specialist work.",
          model: "mock-model",
          name: "Router",
          provider: routerProvider
        }),
        { input: "Escalate twice." }
      )
    ).rejects.toBeInstanceOf(HandoffError);

    expect(runner.getTrace("handoff_limit")).toMatchObject({
      error: { code: "HANDOFF_ERROR" },
      handoffs: [{ toAgent: "Specialist" }],
      status: "failed"
    });
  });

  it("fails before the provider call when Runner middleware rejects", async () => {
    const provider = new MockProvider([assistantResponse("unreachable")]);
    const runner = new Runner({
      generateRunId: () => "middleware_failure",
      middleware: [
        middleware({
          before: () => {
            throw new Error("authentication failed");
          },
          name: "auth"
        })
      ]
    });

    await expect(
      runner.run(
        new Agent({
          instructions: "Answer normally.",
          model: "mock-model",
          name: "Middleware Failure Agent",
          provider
        }),
        { input: "Hello" }
      )
    ).rejects.toThrow("authentication failed");

    expect(provider.requests).toHaveLength(0);
    expect(runner.getTrace("middleware_failure")?.status).toBe("failed");
  });

  it("fails before the provider call when Agent plugin middleware rejects", async () => {
    const provider = new MockProvider([assistantResponse("unreachable")]);
    const failingPlugin = plugin({
      middleware: [
        middleware({
          before: () => {
            throw new Error("plugin policy failed");
          },
          name: "plugin_policy"
        })
      ],
      name: "failing_plugin"
    });
    const runner = new Runner({ generateRunId: () => "plugin_failure" });

    await expect(
      runner.run(
        new Agent({
          instructions: "Answer normally.",
          model: "mock-model",
          name: "Plugin Failure Agent",
          provider
        }).use(failingPlugin),
        { input: "Hello" }
      )
    ).rejects.toThrow("plugin policy failed");

    expect(provider.requests).toHaveLength(0);
    expect(runner.getTrace("plugin_failure")?.middleware).toMatchObject([
      { middleware: "plugin_policy", phase: "before" }
    ]);
  });
});
