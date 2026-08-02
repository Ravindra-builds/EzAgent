import { ValidationError } from "../errors";
import type {
  AgentGuardrails,
  Guardrail,
  GuardrailBlock,
  GuardrailBlockResult,
  GuardrailDecision
} from "./types";

const GUARDRAIL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/;

/** A reusable allow decision for simple guardrail callbacks. */
export const allow: GuardrailDecision = Object.freeze({ action: "allow" });

/** Creates a normalized blocking decision. */
export function block(
  reason: string,
  metadata?: Readonly<Record<string, unknown>>
): GuardrailBlock {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ValidationError("Guardrail block reason must be a non-empty string.", {
      metadata: { field: "reason" }
    });
  }

  return Object.freeze({
    action: "block",
    ...(metadata === undefined ? {} : { metadata: Object.freeze({ ...metadata }) }),
    reason: reason.trim()
  });
}

/** Validates and freezes grouped Agent guardrails. */
export function normalizeGuardrails(guardrails: AgentGuardrails | undefined): AgentGuardrails {
  if (guardrails === undefined) {
    return Object.freeze({});
  }
  if (typeof guardrails !== "object" || guardrails === null) {
    throw new ValidationError("Agent guardrails must be an object.", {
      metadata: { field: "guardrails" }
    });
  }

  return Object.freeze({
    ...(guardrails.input === undefined
      ? {}
      : { input: freezeGuardrails(guardrails.input, "input") }),
    ...(guardrails.output === undefined
      ? {}
      : { output: freezeGuardrails(guardrails.output, "output") }),
    ...(guardrails.tool === undefined ? {} : { tool: freezeGuardrails(guardrails.tool, "tool") }),
    ...(guardrails.approval === undefined
      ? {}
      : { approval: freezeGuardrails(guardrails.approval, "approval") })
  });
}

/** Runs guardrails in declaration order and returns the first block, if any. */
export async function evaluateGuardrails<TGuardrailContext>(
  guardrails: readonly Guardrail<TGuardrailContext>[],
  context: TGuardrailContext
): Promise<GuardrailBlockResult<Guardrail<TGuardrailContext>> | null> {
  for (const guardrail of guardrails) {
    const decision = await guardrail.check(context);
    validateDecision(decision, guardrail.name);
    if (decision.action === "block") {
      return { decision, guardrail };
    }
  }

  return null;
}

/** Creates one named guardrail definition with validation. */
export function guardrail<TGuardrailContext>(input: {
  readonly name: string;
  readonly check: Guardrail<TGuardrailContext>["check"];
}): Guardrail<TGuardrailContext> {
  validateGuardrail(input, "custom");
  return Object.freeze({
    check: input.check,
    name: input.name.trim()
  });
}

function freezeGuardrails<TGuardrailContext>(
  guardrails: readonly Guardrail<TGuardrailContext>[],
  phase: string
): readonly Guardrail<TGuardrailContext>[] {
  if (!Array.isArray(guardrails)) {
    throw new ValidationError(`Agent ${phase} guardrails must be an array.`, {
      metadata: { field: `guardrails.${phase}` }
    });
  }

  const names = new Set<string>();
  const normalized = guardrails.map((entry) => {
    validateGuardrail(entry, phase);
    const name = entry.name.trim();
    if (names.has(name)) {
      throw new ValidationError(`Agent ${phase} guardrails contain duplicate name "${name}".`, {
        metadata: { field: `guardrails.${phase}`, guardrail: name }
      });
    }
    names.add(name);
    return Object.freeze({ check: entry.check, name });
  });

  return Object.freeze(normalized);
}

function validateGuardrail<TGuardrailContext>(
  guardrail:
    | Guardrail<TGuardrailContext>
    | {
        readonly name: string;
        readonly check: unknown;
      },
  phase: string
): void {
  if (typeof guardrail !== "object" || guardrail === null) {
    throw new ValidationError(`Agent ${phase} guardrail must be an object.`);
  }
  if (typeof guardrail.name !== "string" || !GUARDRAIL_NAME_PATTERN.test(guardrail.name.trim())) {
    throw new ValidationError(
      `Agent ${phase} guardrail names must start with a letter or underscore and contain up to 96 safe characters.`,
      { metadata: { field: `guardrails.${phase}.name` } }
    );
  }
  if (typeof guardrail.check !== "function") {
    throw new ValidationError(`Agent ${phase} guardrail check must be a function.`, {
      metadata: { field: `guardrails.${phase}.check`, guardrail: guardrail.name }
    });
  }
}

function validateDecision(decision: GuardrailDecision, guardrailName: string): void {
  if (typeof decision !== "object" || decision === null) {
    throw new ValidationError(`Guardrail "${guardrailName}" returned an invalid decision.`);
  }
  if (decision.action === "allow") {
    return;
  }
  if (
    decision.action === "block" &&
    typeof decision.reason === "string" &&
    decision.reason.trim().length > 0
  ) {
    return;
  }

  throw new ValidationError(`Guardrail "${guardrailName}" returned an invalid decision.`, {
    metadata: { guardrail: guardrailName }
  });
}
