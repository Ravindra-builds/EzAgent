import { normalizeGuardrails } from "../guardrails/guardrails";
import { isEzAgentHandoff } from "../handoff/handoff";
import type { Handoff } from "../handoff/types";
import { normalizeMiddleware } from "../middleware/middleware";
import type { RunnerMiddleware } from "../middleware/types";
import type { MemoryAdapter } from "../memory/types";
import { normalizePlugins } from "../plugins/plugin";
import type { AgentPlugin } from "../plugins/types";
import { markEzAgentAgent } from "./identity";
import type { AgentGuardrails } from "../guardrails/types";
import { createStructuredOutput } from "../output/schema";
import type { StructuredOutputDefinition } from "../output/types";
import { ValidationError } from "../errors";
import type { Provider, ToolChoice } from "../types";
import type { Tool } from "../tools/types";
import { isEzAgentTool } from "../tools/registry";
import type { AgentConfig, AgentMemoryConfig, AgentModelSettings } from "./types";

const DEFAULT_MEMORY_LIMIT = 5;

/**
 * Immutable agent configuration.
 *
 * Agent deliberately contains no execution logic. Runner owns lifecycle,
 * session hydration, provider calls, tool invocation, guardrails, limits, and
 * all mutable runtime state.
 */
export class Agent<TOutput = string> {
  readonly name: string;
  readonly instructions: string;
  readonly model: string;
  readonly provider: Provider;
  readonly tools: readonly Tool[];
  readonly handoffs: readonly Handoff[];
  readonly modelSettings: Readonly<AgentModelSettings>;
  readonly memory: Readonly<AgentMemoryConfig> | undefined;
  readonly guardrails: AgentGuardrails;
  readonly plugins: readonly AgentPlugin[];
  /** Middleware contributed by immutable plugins. Runner composes these after its own middleware. */
  readonly middleware: readonly RunnerMiddleware[];
  readonly output: StructuredOutputDefinition<TOutput> | undefined;

  private readonly toolsByName: Readonly<Record<string, Tool>>;
  private readonly handoffsByToolName: Readonly<Record<string, Handoff>>;

  constructor(config: AgentConfig<TOutput>) {
    validateAgentConfig(config);

    const tools = [...(config.tools ?? [])];
    const toolsByName: Record<string, Tool> = Object.create(null) as Record<string, Tool>;
    for (const tool of tools) {
      if (toolsByName[tool.name] !== undefined) {
        throw new ValidationError(
          `Agent "${config.name}" contains duplicate tool "${tool.name}".`,
          {
            metadata: { agentName: config.name, toolName: tool.name }
          }
        );
      }
      toolsByName[tool.name] = tool;
    }

    const handoffs = normalizeHandoffs(config.handoffs, config.name, toolsByName);
    const handoffsByToolName: Record<string, Handoff> = Object.create(null) as Record<
      string,
      Handoff
    >;
    for (const handoff of handoffs) {
      handoffsByToolName[handoff.toolName] = handoff;
    }
    const plugins = normalizePlugins(config.plugins);
    const middleware = normalizeMiddleware(
      plugins.flatMap((plugin) => plugin.middleware ?? []),
      `Agent "${config.name}" plugin`
    );

    const modelSettings = normalizeModelSettings(config.modelSettings);
    validateToolChoice(
      modelSettings.toolChoice,
      Object.freeze({ ...toolsByName, ...handoffsByToolName }),
      config.name
    );

    this.name = config.name.trim();
    this.instructions = config.instructions.trim();
    this.model = config.model.trim();
    this.provider = config.provider;
    this.tools = Object.freeze(tools);
    this.handoffs = Object.freeze(handoffs);
    this.toolsByName = Object.freeze(toolsByName);
    this.handoffsByToolName = Object.freeze(handoffsByToolName);
    this.modelSettings = modelSettings;
    this.memory = normalizeMemoryConfig(config.memory);
    this.guardrails = normalizeGuardrails(config.guardrails);
    this.plugins = plugins;
    this.middleware = middleware;
    this.output =
      config.output === undefined ? undefined : createStructuredOutput(this.name, config.output);

    markEzAgentAgent(this);
    Object.freeze(this);
  }

  /** Finds an immutable configured tool by its provider-visible name. */
  getTool(name: string): Tool | undefined {
    return this.toolsByName[name];
  }

  /** Finds an immutable configured handoff by its provider-visible tool name. */
  getHandoff(toolName: string): Handoff | undefined {
    return this.handoffsByToolName[toolName];
  }

  /**
   * Returns a new Agent with an additional immutable plugin contribution.
   * The original Agent is never mutated.
   */
  use(plugin: AgentPlugin): Agent<TOutput> {
    return new Agent({
      ...this.toConfig(),
      plugins: [...this.plugins, plugin]
    });
  }

  /** Returns a new immutable Agent with replacement handoff targets. */
  withHandoffs(handoffs: readonly Handoff[]): Agent<TOutput> {
    return new Agent({
      ...this.toConfig(),
      handoffs
    });
  }

  private toConfig(): AgentConfig<TOutput> {
    return {
      guardrails: this.guardrails,
      handoffs: this.handoffs,
      instructions: this.instructions,
      ...(this.memory === undefined ? {} : { memory: this.memory }),
      model: this.model,
      modelSettings: this.modelSettings,
      name: this.name,
      ...(this.output === undefined ? {} : { output: this.output.schema }),
      plugins: this.plugins,
      provider: this.provider,
      tools: this.tools
    };
  }
}

function validateAgentConfig<TOutput>(config: AgentConfig<TOutput>): void {
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("Agent configuration must be an object.");
  }
  if (typeof config.name !== "string" || config.name.trim().length === 0) {
    throw new ValidationError("Agent name must be a non-empty string.", {
      metadata: { field: "name" }
    });
  }
  if (typeof config.instructions !== "string" || config.instructions.trim().length === 0) {
    throw new ValidationError("Agent instructions must be a non-empty string.", {
      metadata: { agentName: config.name, field: "instructions" }
    });
  }
  if (typeof config.model !== "string" || config.model.trim().length === 0) {
    throw new ValidationError("Agent model must be a non-empty string.", {
      metadata: { agentName: config.name, field: "model" }
    });
  }
  if (!isProvider(config.provider)) {
    throw new ValidationError("Agent provider must implement id, chat(), and stream().", {
      metadata: { agentName: config.name, field: "provider" }
    });
  }
  if (config.tools !== undefined && !Array.isArray(config.tools)) {
    throw new ValidationError("Agent tools must be an array.", {
      metadata: { agentName: config.name, field: "tools" }
    });
  }
  for (const tool of config.tools ?? []) {
    if (!isEzAgentTool(tool)) {
      throw new ValidationError("Agent tools must be created with EzAgent.tool().", {
        metadata: { agentName: config.name, field: "tools" }
      });
    }
  }
}

function normalizeHandoffs(
  entries: readonly Handoff[] | undefined,
  agentName: string,
  toolsByName: Readonly<Record<string, Tool>>
): readonly Handoff[] {
  if (entries === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(entries)) {
    throw new ValidationError("Agent handoffs must be an array.", {
      metadata: { agentName, field: "handoffs" }
    });
  }

  const names = new Set<string>();
  const toolNames = new Set<string>(Object.keys(toolsByName));
  const handoffs = entries.map((entry) => {
    if (!isEzAgentHandoff(entry)) {
      throw new ValidationError("Agent handoffs must be created with EzAgent.handoff().", {
        metadata: { agentName, field: "handoffs" }
      });
    }
    if (names.has(entry.name)) {
      throw new ValidationError(`Agent handoffs contain duplicate name "${entry.name}".`, {
        metadata: { agentName, handoff: entry.name }
      });
    }
    if (toolNames.has(entry.toolName)) {
      throw new ValidationError(
        `Agent handoff tool name "${entry.toolName}" collides with another callable.`,
        { metadata: { agentName, toolName: entry.toolName } }
      );
    }
    names.add(entry.name);
    toolNames.add(entry.toolName);
    return entry;
  });

  return Object.freeze(handoffs);
}

function isProvider(value: unknown): value is Provider {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const provider = value as Partial<Provider>;
  const capabilities = provider.capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    return false;
  }

  const capabilityRecord = capabilities as unknown as Record<string, unknown>;
  return (
    typeof provider.id === "string" &&
    provider.id.trim().length > 0 &&
    typeof provider.chat === "function" &&
    typeof provider.stream === "function" &&
    typeof capabilityRecord.streaming === "boolean" &&
    typeof capabilityRecord.tools === "boolean" &&
    typeof capabilityRecord.structuredOutput === "boolean" &&
    typeof capabilityRecord.imageInput === "boolean"
  );
}

function normalizeMemoryConfig(
  memory: AgentMemoryConfig | undefined
): Readonly<AgentMemoryConfig> | undefined {
  if (memory === undefined) {
    return undefined;
  }
  if (typeof memory !== "object" || memory === null || !isMemoryAdapter(memory.adapter)) {
    throw new ValidationError("Agent memory must contain a MemoryAdapter.", {
      metadata: { field: "memory" }
    });
  }
  if (
    memory.namespace !== undefined &&
    (typeof memory.namespace !== "string" || memory.namespace.trim().length === 0)
  ) {
    throw new ValidationError("Agent memory namespace must be a non-empty string.", {
      metadata: { field: "memory.namespace" }
    });
  }
  if (memory.limit !== undefined && (!Number.isSafeInteger(memory.limit) || memory.limit <= 0)) {
    throw new ValidationError("Agent memory limit must be a positive integer.", {
      metadata: { field: "memory.limit" }
    });
  }

  return Object.freeze({
    adapter: memory.adapter,
    limit: memory.limit ?? DEFAULT_MEMORY_LIMIT,
    ...(memory.namespace === undefined ? {} : { namespace: memory.namespace.trim() })
  });
}

function isMemoryAdapter(value: unknown): value is MemoryAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<MemoryAdapter>).save === "function" &&
    typeof (value as Partial<MemoryAdapter>).search === "function" &&
    typeof (value as Partial<MemoryAdapter>).delete === "function"
  );
}

function normalizeModelSettings(
  settings: AgentModelSettings | undefined
): Readonly<AgentModelSettings> {
  if (settings === undefined) {
    return Object.freeze({});
  }
  if (typeof settings !== "object" || settings === null) {
    throw new ValidationError("Agent modelSettings must be an object.", {
      metadata: { field: "modelSettings" }
    });
  }

  validateFiniteNonNegative(settings.temperature, "temperature");
  if (
    settings.topP !== undefined &&
    (!Number.isFinite(settings.topP) || settings.topP < 0 || settings.topP > 1)
  ) {
    throw new ValidationError("Agent modelSettings.topP must be a number from 0 through 1.", {
      metadata: { field: "modelSettings.topP" }
    });
  }
  if (
    settings.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(settings.maxOutputTokens) || settings.maxOutputTokens <= 0)
  ) {
    throw new ValidationError("Agent modelSettings.maxOutputTokens must be a positive integer.", {
      metadata: { field: "modelSettings.maxOutputTokens" }
    });
  }
  if (settings.stopSequences !== undefined) {
    if (
      !Array.isArray(settings.stopSequences) ||
      settings.stopSequences.some(
        (sequence) => typeof sequence !== "string" || sequence.length === 0
      )
    ) {
      throw new ValidationError(
        "Agent modelSettings.stopSequences must be an array of non-empty strings.",
        { metadata: { field: "modelSettings.stopSequences" } }
      );
    }
  }

  const toolChoice = normalizeToolChoice(settings.toolChoice);

  return Object.freeze({
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
    ...(settings.topP === undefined ? {} : { topP: settings.topP }),
    ...(settings.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: settings.maxOutputTokens }),
    ...(settings.stopSequences === undefined
      ? {}
      : { stopSequences: Object.freeze([...settings.stopSequences]) }),
    ...(toolChoice === undefined ? {} : { toolChoice })
  });
}

function normalizeToolChoice(choice: unknown): ToolChoice | undefined {
  if (choice === undefined || typeof choice === "string") {
    return choice as ToolChoice | undefined;
  }
  if (
    typeof choice !== "object" ||
    choice === null ||
    !("type" in choice) ||
    !("name" in choice) ||
    choice.type !== "tool" ||
    typeof choice.name !== "string"
  ) {
    throw new ValidationError(
      "Agent toolChoice must be auto, none, required, or a configured tool.",
      {
        metadata: { field: "modelSettings.toolChoice" }
      }
    );
  }

  return Object.freeze({ name: choice.name.trim(), type: "tool" });
}

function validateFiniteNonNegative(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new ValidationError(
      `Agent modelSettings.${field} must be a non-negative finite number.`,
      {
        metadata: { field: `modelSettings.${field}` }
      }
    );
  }
}

function validateToolChoice(
  choice: ToolChoice | undefined,
  toolsByName: Readonly<Record<string, unknown>>,
  agentName: string
): void {
  if (choice === undefined || choice === "none" || choice === "auto") {
    return;
  }
  if (choice === "required") {
    if (Object.keys(toolsByName).length === 0) {
      throw new ValidationError(
        "Agent toolChoice cannot be required when no tools are configured.",
        {
          metadata: { agentName, field: "modelSettings.toolChoice" }
        }
      );
    }
    return;
  }
  if (
    typeof choice !== "object" ||
    choice === null ||
    choice.type !== "tool" ||
    typeof choice.name !== "string" ||
    choice.name.trim().length === 0
  ) {
    throw new ValidationError(
      "Agent toolChoice must be auto, none, required, or a configured tool.",
      {
        metadata: { agentName, field: "modelSettings.toolChoice" }
      }
    );
  }

  if (toolsByName[choice.name] === undefined) {
    throw new ValidationError(`Agent toolChoice references unknown tool "${choice.name}".`, {
      metadata: { agentName, toolName: choice.name }
    });
  }
}
