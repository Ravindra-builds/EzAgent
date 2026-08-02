import type { ZodType } from "zod";

import type { AgentGuardrails } from "../guardrails";
import type { Handoff } from "../handoff/types";
import type { MemoryAdapter } from "../memory";
import type { AgentPlugin } from "../plugins/types";
import type { Provider, ToolChoice } from "../types";
import type { Tool } from "../tools/types";

/** Provider controls that belong to immutable agent configuration. */
export interface AgentModelSettings {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxOutputTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly toolChoice?: ToolChoice;
}

/** Optional long-term factual memory retrieval configured for an Agent. */
export interface AgentMemoryConfig {
  readonly adapter: MemoryAdapter;
  readonly namespace?: string;
  readonly limit?: number;
}

/** Immutable configuration accepted by `new Agent()`. */
export interface AgentConfig<TOutput = string> {
  readonly name: string;
  readonly instructions: string;
  readonly model: string;
  readonly provider: Provider;
  readonly tools?: readonly Tool[];
  readonly handoffs?: readonly Handoff[];
  readonly modelSettings?: AgentModelSettings;
  readonly memory?: AgentMemoryConfig;
  readonly guardrails?: AgentGuardrails;
  readonly plugins?: readonly AgentPlugin[];
  /** A Zod object schema for validated, typed final output. */
  readonly output?: ZodType<TOutput>;
}
