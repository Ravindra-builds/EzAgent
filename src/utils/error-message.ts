import { redactSensitiveText, truncate } from "./redact";

/** Produces a bounded error message that does not expose common credential shapes. */
export function safeErrorMessage(error: unknown, fallback = "An unknown error occurred."): string {
  const message =
    error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
  return truncate(redactSensitiveText(message), 500);
}
