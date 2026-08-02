import { describe, expect, it } from "vitest";

import { Agent, InMemoryMemory, InMemoryStorage, Runner } from "../../src";
import { assistantResponse, MockProvider } from "../mocks/MockProvider";

describe("Runner sessions and memory", () => {
  it("hydrates a persisted transcript and saves the continued conversation", async () => {
    const storage = new InMemoryStorage();
    const firstProvider = new MockProvider([assistantResponse("Hello, I am ready.")]);
    const firstRunner = new Runner({
      generateRunId: () => "run_session_first",
      storage
    });
    const agent = new Agent({
      instructions: "Be helpful.",
      model: "mock-model",
      name: "Session Agent",
      provider: firstProvider
    });

    const first = await firstRunner.run(agent, {
      input: "Hello",
      sessionId: "customer-1",
      sessionMetadata: { customerId: "cust-1" }
    });
    expect(first.sessionId).toBe("customer-1");

    const secondProvider = new MockProvider([assistantResponse("I remember our greeting.")]);
    const secondRunner = new Runner({
      generateRunId: () => "run_session_second",
      storage
    });
    const continuedAgent = new Agent({
      instructions: "Be helpful.",
      model: "mock-model",
      name: "Session Agent",
      provider: secondProvider
    });
    const loadedEvents: number[] = [];
    secondRunner.on("session:loaded", ({ messageCount }) => {
      loadedEvents.push(messageCount);
    });

    const second = await secondRunner.run(continuedAgent, {
      input: "Do you remember me?",
      sessionId: "customer-1"
    });

    expect(loadedEvents).toEqual([3]);
    expect(secondProvider.requests[0]?.messages).toMatchObject([
      { content: "Be helpful.", role: "system" },
      { content: "Hello", role: "user" },
      { content: "Hello, I am ready.", role: "assistant" },
      { content: "Do you remember me?", role: "user" }
    ]);
    expect(second.messages).toHaveLength(5);

    const session = await storage.loadSession("customer-1");
    expect(session).toMatchObject({ metadata: { customerId: "cust-1" } });
    expect(session?.messages).toHaveLength(5);
  });

  it("adds retrieved facts to provider prompts without persisting them as conversation history", async () => {
    const memory = new InMemoryMemory({ generateId: () => "memory_customer" });
    await memory.save({
      content: "Customer prefers concise Hindi replies.",
      namespace: "customers"
    });
    const provider = new MockProvider([assistantResponse("नमस्ते")]);
    const runner = new Runner({ generateRunId: () => "run_memory" });
    const memoryEvents: string[][] = [];
    runner.on("memory:loaded", ({ memoryIds }) => {
      memoryEvents.push([...memoryIds]);
    });

    const result = await runner.run(
      new Agent({
        instructions: "Be helpful.",
        memory: { adapter: memory, namespace: "customers" },
        model: "mock-model",
        name: "Memory Agent",
        provider
      }),
      {
        input: "How should you reply to me?",
        memory: { query: "customer Hindi" }
      }
    );

    expect(memoryEvents).toEqual([["memory_customer"]]);
    expect(provider.requests[0]?.messages).toMatchObject([
      { content: "Be helpful.", role: "system" },
      {
        content: expect.stringContaining("Customer prefers concise Hindi replies."),
        role: "system"
      },
      { content: "How should you reply to me?", role: "user" }
    ]);
    expect(result.messages.map(({ role }) => role)).toEqual(["system", "user", "assistant"]);
  });
});
