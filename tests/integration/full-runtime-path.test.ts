import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  Agent,
  allow,
  block,
  InMemoryMemory,
  InMemoryStorage,
  InMemoryTraceExporter,
  middleware,
  plugin,
  Runner,
  tool
} from "../../src";
import type { InputGuardrail } from "../../src";
import { assistantResponse, MockProvider } from "../mocks/MockProvider";

describe("Full Runtime Execution Paths", () => {
  it("executes Agent -> Runner -> Provider -> Multiple Tools -> Final Result", async () => {
    const toolA = tool({
      name: "tool_a",
      description: "A",
      schema: z.object({ val: z.string() }),
      execute: async ({ val }) => ({ res: val + "A" })
    });
    const toolB = tool({
      name: "tool_b",
      description: "B",
      schema: z.object({ val: z.string() }),
      execute: async ({ val }) => ({ res: val + "B" })
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([
        { id: "call_1", name: "tool_a", arguments: '{"val":"1"}' },
        { id: "call_2", name: "tool_b", arguments: '{"val":"2"}' }
      ]),
      MockProvider.text("Both tools finished.")
    ]);
    const runner = new Runner({ generateRunId: () => "multi_tool" });
    const agent = new Agent({
      name: "Multi Tool Agent",
      model: "mock-model",
      provider,
      tools: [toolA, toolB],
      instructions: "Run tools."
    });

    const result = await runner.run(agent, { input: "Go" });

    expect(result.output).toBe("Both tools finished.");
    expect(provider.requests).toHaveLength(2);
    const secondReqMsgs = provider.requests[1]?.messages;
    expect(secondReqMsgs?.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("executes Agent -> Runner -> Provider -> Guardrails -> Tool -> Structured Output -> Final Result", async () => {
    const safeTool = tool({
      name: "safe_tool",
      description: "Safe",
      schema: z.object({}),
      execute: async () => ({ ok: true })
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([{ id: "call_safe", name: "safe_tool", arguments: "{}" }]),
      MockProvider.text('{"answer":"safe answer"}')
    ]);

    const inputGuard: InputGuardrail = {
      name: "input_guard",
      check: ({ input }) => (input === "bad" ? block("Blocked") : allow)
    };

    const runner = new Runner({ generateRunId: () => "guard_tool_struct" });
    const agent = new Agent({
      name: "Guard Agent",
      model: "mock-model",
      provider,
      tools: [safeTool],
      guardrails: { input: [inputGuard] },
      output: z.object({ answer: z.string() }),
      instructions: "Respond safely."
    });

    const result = await runner.run(agent, { input: "good" });
    expect(result.output).toMatchObject({ answer: "safe answer" });
    expect(provider.requests).toHaveLength(2);
  });

  it("maintains session persistence across two runs", async () => {
    const storage = new InMemoryStorage();
    const provider1 = new MockProvider([MockProvider.text("Run 1")]);
    const provider2 = new MockProvider([MockProvider.text("Run 2")]);
    const runner1 = new Runner({ generateRunId: () => "session_persist_1", storage });
    const runner2 = new Runner({ generateRunId: () => "session_persist_2", storage });
    const agent1 = new Agent({
      name: "Session Agent",
      model: "mock-model",
      provider: provider1,
      instructions: "Be stateful."
    });
    const agent2 = new Agent({
      name: "Session Agent",
      model: "mock-model",
      provider: provider2,
      instructions: "Be stateful."
    });

    const result1 = await runner1.run(agent1, { input: "First", sessionId: "sess-1" });
    expect(result1.output).toBe("Run 1");

    const result2 = await runner2.run(agent2, { input: "Second", sessionId: "sess-1" });
    expect(result2.output).toBe("Run 2");

    const savedSession = await storage.loadSession("sess-1");
    expect(savedSession?.messages.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant"
    ]);
  });

  it("combines memory injection and tool calls", async () => {
    const memoryAdapter = new InMemoryMemory({ generateId: () => "mem1" });
    await memoryAdapter.save({ content: "Customer prefers concise replies.", namespace: "user" });

    const myTool = tool({
      name: "my_tool",
      description: "Does something",
      schema: z.object({}),
      execute: async () => ({ done: true })
    });
    const provider = new MockProvider([
      MockProvider.toolCalls([{ id: "call_1", name: "my_tool", arguments: "{}" }]),
      MockProvider.text("Done with memory.")
    ]);
    const runner = new Runner({ generateRunId: () => "memory_tool" });
    const agent = new Agent({
      name: "Memory Tool Agent",
      model: "mock-model",
      provider,
      tools: [myTool],
      memory: { adapter: memoryAdapter, namespace: "user" },
      instructions: "Use memory."
    });

    const result = await runner.run(agent, {
      input: "Go",
      memory: { query: "concise" }
    });
    expect(result.output).toBe("Done with memory.");
    expect(provider.requests[0]?.messages[1]?.content).toContain(
      "Customer prefers concise replies."
    );
  });

  it("executes middleware + plugin + trace exporter together", async () => {
    let beforeCalls = 0;
    const testMiddleware = middleware({
      name: "test_mid",
      before: async () => {
        beforeCalls++;
      }
    });
    const testPlugin = plugin({
      name: "test_plugin",
      middleware: [
        middleware({
          name: "plugin_mid",
          before: async () => {
            beforeCalls++;
          }
        })
      ]
    });

    const provider = new MockProvider([assistantResponse("Success")]);
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "mid_plug_trace",
      middleware: [testMiddleware],
      traceExporter: exporter
    });
    const agent = new Agent({
      name: "All Together Agent",
      model: "mock-model",
      provider,
      instructions: "Work together."
    }).use(testPlugin);

    const result = await runner.run(agent, { input: "Go" });
    expect(result.output).toBe("Success");
    expect(beforeCalls).toBe(2);

    const trace = exporter.get("mid_plug_trace");
    expect(trace).toBeDefined();
    expect(trace?.middleware.length).toBeGreaterThanOrEqual(2);
  });
});
