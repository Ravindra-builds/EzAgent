import { ToolError } from "../errors";
import type { Tool, ToolExecute, ToolExecutionContext } from "./types";

type UntypedToolExecute = ToolExecute<unknown, unknown, unknown>;

/**
 * `Symbol.for` keeps tool callback identity intact when consumers mix root and
 * subpath imports (for example `Agent` from `ezagent` and `tool` from
 * `ezagent/tools`). The property is non-enumerable and omitted from provider
 * payloads and normal object inspection.
 */
const TOOL_EXECUTOR_SYMBOL = Symbol.for("@ezagent/tool-executor");

/** @internal Associates an immutable tool definition with its private callback. */
export function registerTool(definition: Tool, execute: UntypedToolExecute): void {
  Object.defineProperty(definition, TOOL_EXECUTOR_SYMBOL, {
    configurable: false,
    enumerable: false,
    value: execute,
    writable: false
  });
}

/** @internal Returns whether a definition was created through EzAgent.tool(). */
export function isEzAgentTool(value: unknown): value is Tool {
  return typeof value === "object" && value !== null && getExecutor(value) !== undefined;
}

/** @internal Invokes a callback registered by `tool()` after runtime validation. */
export async function invokeTool(
  definition: Tool,
  input: unknown,
  context: ToolExecutionContext<unknown>
): Promise<unknown> {
  const execute = getExecutor(definition);
  if (execute === undefined) {
    throw new ToolError(`Tool "${definition.name}" was not created by EzAgent.tool().`, {
      metadata: { toolName: definition.name }
    });
  }

  return execute(input, context);
}

function getExecutor(value: object): UntypedToolExecute | undefined {
  const candidate = (value as Record<PropertyKey, unknown>)[TOOL_EXECUTOR_SYMBOL];
  return typeof candidate === "function" ? (candidate as UntypedToolExecute) : undefined;
}
