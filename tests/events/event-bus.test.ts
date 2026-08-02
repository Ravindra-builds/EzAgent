import { describe, expect, it } from "vitest";

import { EventBus } from "../../src/events";

describe("EventBus", () => {
  it("delivers typed listeners, supports once, and unsubscribes idempotently", () => {
    interface Events {
      readonly ping: { readonly value: number };
    }

    const bus = new EventBus<Events>();
    const received: number[] = [];
    const unsubscribe = bus.on("ping", ({ value }) => {
      received.push(value);
    });
    bus.once("ping", ({ value }) => {
      received.push(value * 10);
    });

    bus.emit("ping", { value: 2 });
    bus.emit("ping", { value: 3 });
    expect(received).toEqual([2, 20, 3]);
    expect(bus.listenerCount("ping")).toBe(1);

    unsubscribe();
    unsubscribe();
    bus.emit("ping", { value: 4 });
    expect(received).toEqual([2, 20, 3]);
    expect(bus.listenerCount("ping")).toBe(0);
  });

  it("contains synchronous and asynchronous listener failures", async () => {
    const listenerErrors: Array<{ event: string; error: unknown }> = [];
    const bus = new EventBus<{ readonly ping: number }>({
      onListenerError: (input) => listenerErrors.push(input)
    });

    bus.on("ping", () => {
      throw new Error("sync listener failure");
    });
    bus.on("ping", async () => {
      throw new Error("async listener failure");
    });

    expect(() => bus.emit("ping", 1)).not.toThrow();
    await Promise.resolve();
    expect(listenerErrors).toHaveLength(2);
    expect(listenerErrors.map(({ event }) => event)).toEqual(["ping", "ping"]);
  });
});
