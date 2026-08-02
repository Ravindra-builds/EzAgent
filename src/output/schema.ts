import { z } from "zod";

import { ValidationError } from "../errors";
import type { JsonSchema } from "../types";
import { deepFreeze, isRecord } from "../utils";
import type { StructuredOutputDefinition } from "./types";

/** Converts a Zod object schema into immutable provider and runtime output metadata. */
export function createStructuredOutput<TOutput>(
  agentName: string,
  schema: z.ZodType<TOutput>
): StructuredOutputDefinition<TOutput> {
  if (!(schema instanceof z.ZodType)) {
    throw new ValidationError("Agent output must be a Zod schema.", {
      metadata: { field: "output" }
    });
  }

  const jsonSchema = zodToJsonSchema(schema, "Agent output schema");
  if (jsonSchema.type !== "object") {
    throw new ValidationError("Agent output schema must describe an object.", {
      metadata: { agentName, field: "output" }
    });
  }

  return Object.freeze({
    jsonSchema: deepFreeze(jsonSchema),
    name: outputNameFromAgentName(agentName),
    schema
  });
}

/** Shared Zod-to-JSON-Schema conversion for tools and structured output. */
export function zodToJsonSchema(schema: z.ZodType, subject: string): JsonSchema {
  try {
    const generated: unknown = z.toJSONSchema(schema, { unrepresentable: "any" });
    if (!isRecord(generated)) {
      throw new ValidationError(`${subject} did not produce an object JSON Schema.`);
    }

    return generated as JsonSchema;
  } catch (cause) {
    if (cause instanceof ValidationError) {
      throw cause;
    }

    throw new ValidationError(`${subject} could not be converted to JSON Schema.`, { cause });
  }
}

function outputNameFromAgentName(agentName: string): string {
  const normalized = agentName
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = normalized.length === 0 ? "agent" : normalized;
  return `${base.slice(0, 55)}_output`;
}
