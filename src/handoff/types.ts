import type { JsonSchema } from "../types";

/** Immutable delegation target exposed to a model as a provider tool. */
export interface Handoff {
  /** The target is validated as an EzAgent Agent by `handoff()` and Agent configuration. */
  readonly agent: unknown;
  readonly name: string;
  readonly description: string;
  readonly toolName: string;
  readonly parameters: JsonSchema;
}

/** Configuration for a model-visible handoff target. */
export interface HandoffConfig {
  readonly name?: string;
  readonly description?: string;
}
