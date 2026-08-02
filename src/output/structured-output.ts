import type {
  OutputValidationIssue,
  StructuredOutputDefinition,
  StructuredOutputParseResult
} from "./types";

/** Validates a final model message against a structured-output definition. */
export function parseStructuredOutput<TOutput>(
  definition: StructuredOutputDefinition<TOutput>,
  text: string
): StructuredOutputParseResult<TOutput> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return {
      issues: Object.freeze([{ code: "invalid_json", path: "$" }]),
      reason: "invalid_json",
      success: false
    };
  }

  const result = definition.schema.safeParse(value);
  if (result.success) {
    return { output: result.data, success: true };
  }

  return {
    issues: Object.freeze(
      result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.length === 0 ? "$" : `$.${issue.path.join(".")}`
      }))
    ),
    reason: "schema_validation",
    success: false
  };
}

/** Builds a bounded, schema-preserving correction instruction for the next model turn. */
export function createStructuredOutputRepairPrompt(
  issues: readonly OutputValidationIssue[]
): string {
  const detail = issues
    .slice(0, 8)
    .map((issue) => `${issue.path}: ${issue.code}`)
    .join("; ");

  return [
    "Your previous final response did not satisfy the required structured output schema.",
    "Return only a corrected JSON object that satisfies the configured schema.",
    `Validation issues: ${detail || "unknown validation failure"}.`
  ].join(" ");
}
