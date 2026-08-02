import { z } from "zod";

import { ValidationError } from "../errors";
import { zodToJsonSchema } from "../output/schema";
import type { JsonSchema } from "../types";
import { deepFreeze } from "../utils";
import { registerTool } from "./registry";
import type { Tool, ToolConfig, ToolExecute, ToolExecutionContext } from "./types";

const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

type UntypedToolExecute = ToolExecute<unknown, unknown, unknown>;

/**
 * Creates an immutable tool definition with typed Zod input validation.
 *
 * The returned definition is safe to place in an Agent. Its callback remains
 * encapsulated so every invocation goes through ToolExecutor validation,
 * cancellation, timeout, serialization, and error handling.
 */
export function tool<TSchema extends z.ZodType, TResult, TContext = unknown>(
  config: ToolConfig<TSchema, TResult, TContext>
): Tool<z.output<TSchema>, TResult, TContext> {
  validateToolConfig(config);
  const parameters = zodToJsonSchema(config.schema, "Tool schema");
  assertObjectParameters(parameters, config.name);

  const definition: Tool<z.output<TSchema>, TResult, TContext> = {
    description: config.description.trim(),
    name: config.name.trim(),
    parameters: deepFreeze(parameters),
    schema: config.schema,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs })
  };

  const execute: UntypedToolExecute = async (input, context) =>
    config.execute(
      input as z.output<TSchema>,
      context as unknown as ToolExecutionContext<TContext>
    );
  registerTool(definition, execute);

  return Object.freeze(definition);
}

function validateToolConfig<TSchema extends z.ZodType, TResult, TContext>(
  config: ToolConfig<TSchema, TResult, TContext>
): void {
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("Tool configuration must be an object.");
  }
  if (typeof config.name !== "string" || !TOOL_NAME_PATTERN.test(config.name.trim())) {
    throw new ValidationError(
      "Tool names must start with a letter or underscore and contain up to 64 letters, numbers, underscores, or hyphens.",
      { metadata: { field: "name" } }
    );
  }
  if (typeof config.description !== "string" || config.description.trim().length === 0) {
    throw new ValidationError("Tool descriptions must be non-empty strings.", {
      metadata: { field: "description", toolName: config.name }
    });
  }
  if (typeof config.execute !== "function") {
    throw new ValidationError("Tool execute must be a function.", {
      metadata: { field: "execute", toolName: config.name }
    });
  }
  if (!(config.schema instanceof z.ZodType)) {
    throw new ValidationError("Tool schema must be a Zod schema.", {
      metadata: { field: "schema", toolName: config.name }
    });
  }
  if (
    config.timeoutMs !== undefined &&
    (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0)
  ) {
    throw new ValidationError("Tool timeoutMs must be a positive integer.", {
      metadata: { field: "timeoutMs", toolName: config.name }
    });
  }
}

function assertObjectParameters(parameters: JsonSchema, toolName: string): void {
  if (parameters.type !== "object") {
    throw new ValidationError("Tool schemas must describe an object of named arguments.", {
      metadata: { toolName }
    });
  }
}
