import { isEzAgentAgent } from "../agent/identity";
import type { Agent } from "../agent/agent";
import { HandoffError, ValidationError } from "../errors";
import type { JsonSchema } from "../types";
import { deepFreeze } from "../utils";
import type { Handoff, HandoffConfig } from "./types";

const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

const HANDOFF_PARAMETERS: JsonSchema = deepFreeze({
  additionalProperties: false,
  properties: {
    reason: {
      description: "Optional reason for delegating to the specialist.",
      type: "string"
    }
  },
  type: "object"
});

/**
 * Creates an immutable model-visible delegation target.
 *
 * The model invokes `toolName`; Runner then switches to the target Agent while
 * preserving the transcript and enforcing handoff-loop/limit protection.
 */
export function handoff<TOutput>(target: Agent<TOutput>, config: HandoffConfig = {}): Handoff {
  if (!isEzAgentAgent(target)) {
    throw new ValidationError("Handoff target must be an EzAgent Agent.", {
      metadata: { field: "target" }
    });
  }
  if (typeof config !== "object" || config === null) {
    throw new ValidationError("Handoff configuration must be an object.");
  }

  const name = (config.name ?? target.name).trim();
  if (name.length === 0) {
    throw new ValidationError("Handoff name must be a non-empty string.", {
      metadata: { field: "name" }
    });
  }
  const toolName = handoffToolName(name);
  const description = (
    config.description ?? `Delegate this request to the ${target.name} specialist.`
  ).trim();
  if (description.length === 0) {
    throw new ValidationError("Handoff description must be a non-empty string.", {
      metadata: { field: "description", handoff: name }
    });
  }

  return Object.freeze({
    agent: target,
    description,
    name,
    parameters: HANDOFF_PARAMETERS,
    toolName
  });
}

/** @internal Validates configured Handoff objects before Agent construction. */
export function isEzAgentHandoff(value: unknown): value is Handoff {
  return (
    typeof value === "object" &&
    value !== null &&
    isEzAgentAgent((value as Partial<Handoff>).agent) &&
    typeof (value as Partial<Handoff>).name === "string" &&
    typeof (value as Partial<Handoff>).description === "string" &&
    typeof (value as Partial<Handoff>).toolName === "string" &&
    TOOL_NAME_PATTERN.test((value as Partial<Handoff>).toolName ?? "")
  );
}

/** @internal Produces an actionable failure for invalid handoff runtime requests. */
export function handoffError(
  message: string,
  metadata: Readonly<Record<string, unknown>>
): HandoffError {
  return new HandoffError(message, { metadata });
}

function handoffToolName(name: string): string {
  const normalized = name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = normalized.length === 0 ? "agent" : normalized;
  const toolName = `handoff_to_${base}`.slice(0, 64);

  if (!TOOL_NAME_PATTERN.test(toolName)) {
    throw new ValidationError("Handoff tool name could not be normalized safely.", {
      metadata: { handoff: name }
    });
  }

  return toolName;
}
