import { ValidationError } from "../errors";
import type {
  MiddlewareConfig,
  MiddlewareContext,
  MiddlewareErrorContext,
  MiddlewareResultContext,
  RunnerMiddleware
} from "./types";

const MIDDLEWARE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/;

/** Creates and freezes a named lifecycle middleware. */
export function middleware(config: MiddlewareConfig): RunnerMiddleware {
  validateMiddleware(config, "middleware");

  return Object.freeze({
    name: config.name.trim(),
    ...(config.before === undefined ? {} : { before: config.before }),
    ...(config.after === undefined ? {} : { after: config.after }),
    ...(config.onError === undefined ? {} : { onError: config.onError })
  });
}

/** Validates, de-duplicates, and freezes a middleware pipeline. */
export function normalizeMiddleware(
  entries: readonly RunnerMiddleware[] | undefined,
  scope: string
): readonly RunnerMiddleware[] {
  if (entries === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(entries)) {
    throw new ValidationError(`${scope} middleware must be an array.`, {
      metadata: { field: "middleware" }
    });
  }

  const names = new Set<string>();
  const normalized = entries.map((entry) => {
    validateMiddleware(entry, scope);
    const name = entry.name.trim();
    if (names.has(name)) {
      throw new ValidationError(`${scope} middleware contains duplicate name "${name}".`, {
        metadata: { middleware: name }
      });
    }
    names.add(name);
    return Object.freeze({
      name,
      ...(entry.before === undefined ? {} : { before: entry.before }),
      ...(entry.after === undefined ? {} : { after: entry.after }),
      ...(entry.onError === undefined ? {} : { onError: entry.onError })
    });
  });

  return Object.freeze(normalized);
}

/** Runs before hooks in declaration order. */
export async function runMiddlewareBefore(
  entries: readonly RunnerMiddleware[],
  context: MiddlewareContext
): Promise<void> {
  for (const entry of entries) {
    await entry.before?.(context);
  }
}

/** Runs after hooks in reverse declaration order. */
export async function runMiddlewareAfter(
  entries: readonly RunnerMiddleware[],
  context: MiddlewareResultContext
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    await entry.after?.(context);
  }
}

/** Runs error hooks in reverse order and deliberately isolates hook failures. */
export async function runMiddlewareError(
  entries: readonly RunnerMiddleware[],
  context: MiddlewareErrorContext
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    try {
      await entry.onError?.(context);
    } catch {
      // Error hooks are observability/cleanup hooks and must not mask the run error.
    }
  }
}

function validateMiddleware(value: MiddlewareConfig, scope: string): void {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`${scope} middleware must be an object.`);
  }
  if (typeof value.name !== "string" || !MIDDLEWARE_NAME_PATTERN.test(value.name.trim())) {
    throw new ValidationError(
      `${scope} middleware names must start with a letter or underscore and contain up to 96 safe characters.`,
      { metadata: { field: "middleware.name" } }
    );
  }
  for (const hook of ["before", "after", "onError"] as const) {
    const candidate = value[hook];
    if (candidate !== undefined && typeof candidate !== "function") {
      throw new ValidationError(`${scope} middleware ${hook} must be a function.`, {
        metadata: { field: `middleware.${hook}`, middleware: value.name }
      });
    }
  }
}
