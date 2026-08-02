import { z } from "zod";
import { describe, expect, it } from "vitest";

import { Agent, AgentError, Runner, TimeoutError, tool } from "../../src";
import { assistantResponse, MockProvider } from "../mocks/MockProvider";

describe("Runner", () => {
  it("runs a bounded provider-tool-provider loop and emits ordered runtime events", async () => {
    const observedContexts: unknown[] = [];
    const weather = tool({
      description: "Looks up weather for a city.",
      execute: ({ city }, context) => {
        observedContexts.push(context.context);
        return { city, temperatureC: 27 };
      },
      name: "weather",
      schema: z.object({ city: z.string().min(1) })
    });
    const provider = new MockProvider([
      assistantResponse("", [
        {
          arguments: '{"city":"Ranchi"}',
          id: "call_weather_1",
          name: "weather"
        }
      ]),
      assistantResponse("Ranchi is 27°C.")
    ]);
    const agent = new Agent({
      instructions: "Use weather for current weather questions.",
      model: "mock-model",
      name: "Weather Agent",
      provider,
      tools: [weather]
    });
    const runner = new Runner({ generateRunId: () => "run_weather" });
    const eventTypes: string[] = [];
    for (const eventName of [
      "run:start",
      "model:start",
      "model:end",
      "tool:start",
      "tool:end",
      "tool:error",
      "completed",
      "failed"
    ] as const) {
      runner.on(eventName, ({ type }) => {
        eventTypes.push(type);
      });
    }

    const result = await runner.run(agent, {
      context: { requestedBy: "test" },
      input: "What is the weather in Ranchi?"
    });

    expect(result).toMatchObject({
      agentName: "Weather Agent",
      iterations: 2,
      output: "Ranchi is 27°C.",
      runId: "run_weather",
      toolCalls: 1
    });
    expect(result.messages.map(({ role }) => role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant"
    ]);
    expect(observedContexts).toEqual([{ requestedBy: "test" }]);
    expect(eventTypes).toEqual([
      "run:start",
      "model:start",
      "model:end",
      "tool:start",
      "tool:end",
      "model:start",
      "model:end",
      "completed"
    ]);

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]).toMatchObject({
      messages: [
        { content: "Use weather for current weather questions.", role: "system" },
        { content: "What is the weather in Ranchi?", role: "user" }
      ],
      model: "mock-model",
      tools: [
        {
          name: "weather",
          parameters: {
            properties: { city: { type: "string" } },
            type: "object"
          }
        }
      ]
    });
    expect(provider.requests[1]?.messages).toMatchObject([
      { role: "system" },
      { role: "user" },
      {
        role: "assistant",
        toolCalls: [{ id: "call_weather_1", name: "weather" }]
      },
      {
        content: '{"city":"Ranchi","temperatureC":27}',
        name: "weather",
        role: "tool",
        toolCallId: "call_weather_1"
      }
    ]);
  });

  it("returns tool failures to the model and lets a later model turn recover", async () => {
    let executeCalls = 0;
    const weather = tool({
      description: "Looks up weather for a city.",
      execute: ({ city }) => {
        executeCalls += 1;
        return city;
      },
      name: "weather",
      schema: z.object({ city: z.string().min(1) })
    });
    const provider = new MockProvider([
      assistantResponse("", [
        {
          arguments: '{"city":""}',
          id: "call_invalid",
          name: "weather"
        }
      ]),
      assistantResponse("Please provide a non-empty city name.")
    ]);
    const runner = new Runner({ generateRunId: () => "run_recovery" });
    const toolErrors: string[] = [];
    runner.on("tool:error", ({ error }) => {
      toolErrors.push(error.name);
    });

    const result = await runner.run(
      new Agent({
        instructions: "Validate weather requests.",
        model: "mock-model",
        name: "Recovery Agent",
        provider,
        tools: [weather]
      }),
      { input: "Check weather" }
    );

    expect(executeCalls).toBe(0);
    expect(toolErrors).toEqual(["ToolError"]);
    expect(result.output).toBe("Please provide a non-empty city name.");
    const toolMessage = provider.requests[1]?.messages[3];
    expect(toolMessage).toMatchObject({ name: "weather", role: "tool" });
    expect(JSON.parse(String(toolMessage?.content))).toMatchObject({
      error: { code: "TOOL_ERROR" }
    });
  });

  it("enforces the maximum iteration boundary and emits failed", async () => {
    const echo = tool({
      description: "Echoes text.",
      execute: ({ text }) => text,
      name: "echo",
      schema: z.object({ text: z.string() })
    });
    const provider = new MockProvider([
      assistantResponse("", [{ arguments: '{"text":"again"}', id: "call_loop", name: "echo" }])
    ]);
    const runner = new Runner({
      generateRunId: () => "run_limit",
      maxIterations: 1
    });
    const failed: string[] = [];
    runner.on("failed", ({ error }) => {
      failed.push(error.name);
    });

    await expect(
      runner.run(
        new Agent({
          instructions: "Call echo.",
          model: "mock-model",
          name: "Loop Agent",
          provider,
          tools: [echo]
        }),
        { input: "Loop" }
      )
    ).rejects.toBeInstanceOf(AgentError);

    expect(provider.requests).toHaveLength(1);
    expect(failed).toEqual(["AgentError"]);
  });

  it("enforces the maximum tool-call boundary before executing an excess call", async () => {
    const echo = tool({
      description: "Echoes text.",
      execute: ({ text }) => text,
      name: "echo",
      schema: z.object({ text: z.string() })
    });
    const provider = new MockProvider([
      assistantResponse("", [
        { arguments: '{"text":"first"}', id: "call_one", name: "echo" },
        { arguments: '{"text":"second"}', id: "call_two", name: "echo" }
      ])
    ]);
    const runner = new Runner({
      generateRunId: () => "run_tool_limit",
      maxToolCalls: 1
    });

    await expect(
      runner.run(
        new Agent({
          instructions: "Call echo.",
          model: "mock-model",
          name: "Tool Limit Agent",
          provider,
          tools: [echo]
        }),
        { input: "Call twice" }
      )
    ).rejects.toMatchObject({
      code: "AGENT_ERROR",
      metadata: expect.objectContaining({ limit: 1 })
    });

    expect(provider.requests).toHaveLength(1);
  });

  it("enforces a run deadline even when a provider ignores its abort signal", async () => {
    const provider = new MockProvider([MockProvider.timeout()]);
    const runner = new Runner({
      generateRunId: () => "run_timeout",
      timeoutMs: 10
    });

    await expect(
      runner.run(
        new Agent({
          instructions: "Respond eventually.",
          model: "mock-model",
          name: "Timeout Agent",
          provider
        }),
        { input: "Hello" }
      )
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
