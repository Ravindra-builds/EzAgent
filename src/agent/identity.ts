/** A global symbol preserves Agent identity across root/subpath package bundles. */
const AGENT_BRAND = Symbol.for("@ezagent/agent");

/** @internal Marks an immutable Agent instance without exposing a mutable field. */
export function markEzAgentAgent(value: object): void {
  Object.defineProperty(value, AGENT_BRAND, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
}

/** @internal Supports safe Agent identity checks across root and subpath bundles. */
export function isEzAgentAgent(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[AGENT_BRAND] === true
  );
}
