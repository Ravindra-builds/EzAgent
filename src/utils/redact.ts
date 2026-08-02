const SENSITIVE_PATTERNS: readonly [RegExp, string][] = [
  [/(Bearer\s+)[^\s,;]+/gi, "$1[REDACTED]"],
  [/(\b(?:api[_-]?key|token|authorization)\s*[=:]\s*["']?)[^\s"',;]+/gi, "$1[REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED]"],
  [/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]"]
];

/** Removes common credential shapes before text is put in an error message. */
export function redactSensitiveText(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value
  );
}

/** Truncates diagnostic text without splitting the caller's primary message logic. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
