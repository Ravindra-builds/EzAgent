import type { ZodType } from "zod";

import type { JsonSchema } from "../types";

/** Immutable structured-output metadata derived from an Agent's Zod schema. */
export interface StructuredOutputDefinition<TOutput = unknown> {
  readonly name: string;
  readonly schema: ZodType<TOutput>;
  readonly jsonSchema: JsonSchema;
}

/** A sanitized Zod validation issue suitable for errors and repair prompts. */
export interface OutputValidationIssue {
  readonly code: string;
  readonly path: string;
}

/** Result of parsing a model's final structured JSON response. */
export type StructuredOutputParseResult<TOutput> =
  | {
      readonly success: true;
      readonly output: TOutput;
    }
  | {
      readonly success: false;
      readonly reason: "invalid_json" | "schema_validation";
      readonly issues: readonly OutputValidationIssue[];
    };
