import { describe, expect, it } from "vitest";

import { InMemoryMemory } from "../../src";

describe("InMemoryMemory", () => {
  it("stores factual records, filters namespaces, and ranks lexical matches", async () => {
    let nextId = 0;
    const memory = new InMemoryMemory({
      generateId: () => `memory-${String(++nextId)}`,
      now: () => new Date("2026-08-02T00:00:00.000Z")
    });

    await memory.save({
      content: "Ranchi is the capital city of Jharkhand.",
      namespace: "geo"
    });
    await memory.save({
      content: "Ranchi has several universities and institutes.",
      namespace: "geo"
    });
    await memory.save({
      content: "The customer prefers concise Hindi replies.",
      namespace: "customer"
    });

    const results = await memory.search("Ranchi capital", { namespace: "geo", limit: 5 });
    expect(results).toHaveLength(2);
    expect(results[0]?.memory.content).toContain("capital");
    expect(results.map(({ memory: record }) => record.namespace)).toEqual(["geo", "geo"]);

    const saved = await memory.save({
      content: "Ranchi is Jharkhand's capital.",
      id: "memory-1",
      namespace: "geo"
    });
    expect(saved.createdAt).toBe("2026-08-02T00:00:00.000Z");
    expect(await memory.delete("memory-1")).toBe(true);
    expect(await memory.search("capital", { namespace: "geo" })).toHaveLength(0);
  });
});
