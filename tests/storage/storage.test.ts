import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createSession, FileStorage, InMemoryStorage } from "../../src";

function sampleSession(sessionId = "session-1") {
  return createSession({
    createdAt: "2026-08-02T00:00:00.000Z",
    messages: [
      { content: "Be helpful.", role: "system" },
      { content: "Hello", role: "user" },
      { content: "Hi!", role: "assistant" }
    ],
    metadata: { customerId: "customer-1" },
    sessionId,
    updatedAt: "2026-08-02T00:01:00.000Z"
  });
}

describe("session storage adapters", () => {
  it("isolates saved sessions in InMemoryStorage", async () => {
    const storage = new InMemoryStorage();
    const session = sampleSession();

    await storage.saveSession(session);
    const firstLoad = await storage.loadSession("session-1");
    const secondLoad = await storage.loadSession("session-1");

    expect(firstLoad).toEqual(session);
    expect(firstLoad).not.toBe(session);
    expect(secondLoad).not.toBe(firstLoad);
    expect(await storage.deleteSession("session-1")).toBe(true);
    expect(await storage.loadSession("session-1")).toBeNull();
    expect(await storage.deleteSession("session-1")).toBe(false);
  });

  it("persists valid sessions atomically as local JSON files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ezagent-storage-"));
    const storage = new FileStorage({ directory });

    try {
      await storage.saveSession(sampleSession("customer/../one"));
      const loaded = await storage.loadSession("customer/../one");

      expect(loaded).toMatchObject({
        metadata: { customerId: "customer-1" },
        sessionId: "customer/../one"
      });
      expect(loaded?.messages.map(({ role }) => role)).toEqual(["system", "user", "assistant"]);
      expect(await storage.deleteSession("customer/../one")).toBe(true);
      expect(await storage.loadSession("customer/../one")).toBeNull();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
