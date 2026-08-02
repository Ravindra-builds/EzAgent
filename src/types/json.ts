/** A value that can be represented in JSON. */
export type JsonPrimitive = string | number | boolean | null;

/** A JSON array. */
export type JsonArray = readonly JsonValue[];

/** A JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A value that can be represented in JSON. */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * A provider-neutral JSON Schema document.
 *
 * Providers support different JSON Schema dialects. EzAgent deliberately keeps
 * this type open while retaining the common keywords for autocomplete.
 */
export interface JsonSchema {
  readonly $schema?: string;
  readonly $id?: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema | readonly JsonSchema[];
  readonly enum?: readonly JsonValue[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly [keyword: string]: unknown;
}
