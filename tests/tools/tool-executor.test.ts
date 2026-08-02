import { z } from "zod";
import { describe, expect, it } from "vitest";

import { TimeoutError, tool, ToolExecutor } from "../../src";

describe("ToolExecutor", () => {
  it("validates Zod arguments, provides execution context, and serializes object results", async () => {
    const weather = tool({
      description: "Gets a city's weather.",
      execute: ({ city, unit }, context) => ({
        city,
        requestId: context.runId,
        unit
      }),
      name: "weather",
      schema: z.object({
        city: z.string().min(1),
        unit: z.enum(["C", "F"])
      })
    });
    const executor = new ToolExecutor();

    const result = await executor.execute(weather, {
      agentName: "Weather Agent",
      context: { source: "test" },
      runId: "run_tools_1",
      toolCall: {
        arguments: '{"city":"Ranchi","unit":"C"}',
        id: "call_weather",
        name: "weather"
      }
    });

    expect(weather.parameters).toMatchObject({
      properties: {
        city: { type: "string" },
        unit: { enum: ["C", "F"] }
      },
      type: "object"
    });
    expect(result).toMatchObject({
      output: '{"city":"Ranchi","requestId":"run_tools_1","unit":"C"}',
      toolCallId: "call_weather",
      toolName: "weather",
      value: {
        city: "Ranchi",
        requestId: "run_tools_1",
        unit: "C"
      }
    });
  });

  it("returns useful ToolErrors for malformed and schema-invalid arguments", async () => {
    const echo = tool({
      description: "Echoes a required value.",
      execute: ({ value }) => value,
      name: "echo",
      schema: z.object({ value: z.string().min(1) })
    });
    const executor = new ToolExecutor();

    await expect(
      executor.execute(echo, {
        agentName: "Echo Agent",
        context: undefined,
        runId: "run_tools_2",
        toolCall: { arguments: "not-json", id: "call_bad_json", name: "echo" }
      })
    ).rejects.toMatchObject({
      code: "TOOL_ERROR",
      metadata: expect.objectContaining({ phase: "parse", toolName: "echo" })
    });

    await expect(
      executor.execute(echo, {
        agentName: "Echo Agent",
        context: undefined,
        runId: "run_tools_2",
        toolCall: { arguments: '{"value":""}', id: "call_bad_shape", name: "echo" }
      })
    ).rejects.toMatchObject({
      code: "TOOL_ERROR",
      metadata: expect.objectContaining({ phase: "validation", toolName: "echo" })
    });
  });

  it("aborts an uncooperative tool at its deadline", async () => {
    const slow = tool({
      description: "Waits until cancellation.",
      execute: async (_input, context) =>
        new Promise<string>((resolve) => {
          context.signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
        }),
      name: "slow",
      schema: z.object({}),
      timeoutMs: 10
    });
    const executor = new ToolExecutor();

    await expect(
      executor.execute(slow, {
        agentName: "Slow Agent",
        context: undefined,
        runId: "run_tools_3",
        toolCall: { arguments: "{}", id: "call_slow", name: "slow" }
      })
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
