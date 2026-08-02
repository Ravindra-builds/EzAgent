import { z } from "zod";
import { describe, expect, it } from "vitest";

import { Agent, InMemoryTraceExporter, Runner, tool } from "../../src";
import { MockProvider } from "../mocks/MockProvider";

describe("Agent → Runner → Provider → Tool → Final Output", () => {
  it("executes a complete deterministic agent workflow without external APIs", async () => {
    const provider = new MockProvider([
      MockProvider.toolCalls([
        {
          arguments: '{"city":"Ranchi"}',
          id: "call_weather",
          name: "weather"
        }
      ]),
      MockProvider.text("Ranchi is currently 27°C.")
    ]);
    const weather = tool({
      description: "Looks up weather for a city.",
      execute: async ({ city }) => ({ city, temperatureC: 27 }),
      name: "weather",
      schema: z.object({ city: z.string().min(1) })
    });
    const exporter = new InMemoryTraceExporter();
    const runner = new Runner({
      generateRunId: () => "integration_weather",
      traceExporter: exporter
    });
    const events: string[] = [];
    runner.on("model:start", ({ type }) => {
      events.push(type);
    });
    runner.on("tool:start", ({ type }) => {
      events.push(type);
    });
    runner.on("tool:end", ({ type }) => {
      events.push(type);
    });
    runner.on("completed", ({ type }) => {
      events.push(type);
    });

    const result = await runner.run(
      new Agent({
        instructions: "Use weather for current weather questions.",
        model: "mock-model",
        name: "Weather Integration Agent",
        provider,
        tools: [weather]
      }),
      { input: "What is the weather in Ranchi?" }
    );

    expect(result.output).toBe("Ranchi is currently 27°C.");
    expect(result.messages.map(({ role }) => role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant"
    ]);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({
      content: '{"city":"Ranchi","temperatureC":27}',
      name: "weather",
      role: "tool"
    });
    expect(events).toEqual(["model:start", "tool:start", "tool:end", "model:start", "completed"]);
    expect(result.trace.providerCalls).toHaveLength(2);
    expect(result.trace.tools).toMatchObject([{ toolCall: { name: "weather" } }]);
    expect(exporter.get("integration_weather")).toEqual(result.trace);
  });
});
