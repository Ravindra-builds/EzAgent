import { z } from "zod";
import { describe, expect, it } from "vitest";

import { Agent, ValidationError, tool } from "../../src";
import { MockProvider } from "../mocks/MockProvider";

describe("Agent", () => {
  it("copies configuration into immutable agent metadata", () => {
    const echo = tool({
      description: "Echoes text.",
      execute: ({ text }) => text,
      name: "echo",
      schema: z.object({ text: z.string() })
    });
    const configuredTools = [echo];
    const stopSequences = ["END"];
    const toolChoice: { name: string; type: "tool" } = { name: "echo", type: "tool" };
    const agent = new Agent({
      instructions: "Use the echo tool when needed.",
      model: "mock-model",
      modelSettings: { stopSequences, toolChoice },
      name: "Echo Agent",
      provider: new MockProvider([]),
      tools: configuredTools
    });

    configuredTools.pop();
    stopSequences.push("MUTATED");
    toolChoice.name = "mutated";
    expect(agent.tools).toEqual([echo]);
    expect(Object.isFrozen(agent)).toBe(true);
    expect(Object.isFrozen(agent.tools)).toBe(true);
    expect(agent.modelSettings).toMatchObject({
      stopSequences: ["END"],
      toolChoice: { name: "echo", type: "tool" }
    });
    expect(agent.getTool("echo")).toBe(echo);
  });

  it("rejects duplicate tool names and invalid tool choices", () => {
    const createEcho = () =>
      tool({
        description: "Echoes text.",
        execute: ({ text }) => text,
        name: "echo",
        schema: z.object({ text: z.string() })
      });

    expect(
      () =>
        new Agent({
          instructions: "Test.",
          model: "mock-model",
          name: "Duplicate Agent",
          provider: new MockProvider([]),
          tools: [createEcho(), createEcho()]
        })
    ).toThrow(ValidationError);

    expect(
      () =>
        new Agent({
          instructions: "Test.",
          model: "mock-model",
          modelSettings: { toolChoice: { name: "missing", type: "tool" } },
          name: "Choice Agent",
          provider: new MockProvider([]),
          tools: [createEcho()]
        })
    ).toThrow(/unknown tool/);

    expect(
      () =>
        new Agent({
          instructions: "Test.",
          model: "mock-model",
          name: "Invalid Tool Agent",
          provider: new MockProvider([]),
          tools: [{} as never]
        })
    ).toThrow(/created with EzAgent.tool/);
  });
});
