import type { RunnerMiddleware } from "../middleware";

/** Immutable extension package that can contribute middleware to an Agent. */
export interface AgentPlugin {
  readonly name: string;
  readonly middleware?: readonly RunnerMiddleware[];
}

/** Factory input for a named Agent plugin. */
export type PluginConfig = AgentPlugin;
