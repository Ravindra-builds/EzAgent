/** Additional diagnostic context attached to an EzAgent error. */
export type ErrorMetadata = Readonly<Record<string, unknown>>;

/** Construction options shared by all EzAgent errors. */
export interface EzAgentErrorOptions {
  readonly code?: string;
  readonly cause?: unknown;
  readonly metadata?: ErrorMetadata;
}

/** Base class for all errors intentionally thrown by EzAgent. */
export class EzAgentError extends Error {
  readonly code: string;
  readonly metadata: ErrorMetadata;

  constructor(message: string, options: EzAgentErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? "EZAGENT_ERROR";
    this.metadata = options.metadata ?? {};
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An invalid agent configuration or runtime state. */
export class AgentError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "AGENT_ERROR" });
  }
}

/** A configuration error detected before contacting a provider. */
export class ProviderConfigurationError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "PROVIDER_CONFIGURATION_ERROR" });
  }
}

/** A failure while communicating with or decoding a provider. */
export class ProviderError extends EzAgentError {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: Omit<EzAgentErrorOptions, "code" | "metadata"> & {
      readonly provider: string;
      readonly status?: number;
      readonly retryable?: boolean;
      readonly metadata?: ErrorMetadata;
    }
  ) {
    const retryable = options.retryable ?? false;
    const metadata: Record<string, unknown> = {
      ...options.metadata,
      provider: options.provider,
      retryable
    };

    if (options.status !== undefined) {
      metadata.status = options.status;
    }

    super(message, {
      cause: options.cause,
      code: "PROVIDER_ERROR",
      metadata
    });
    this.provider = options.provider;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    this.retryable = retryable;
  }
}

/** A tool execution failure. Implemented fully with the tool runtime in milestone 3. */
export class ToolError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "TOOL_ERROR" });
  }
}

/** A validation failure for tool arguments, output, or configuration. */
export class ValidationError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "VALIDATION_ERROR" });
  }
}

/** An operation exceeded its configured deadline. */
export class TimeoutError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "TIMEOUT_ERROR" });
  }
}

/** An invalid or exhausted agent handoff. */
export class HandoffError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "HANDOFF_ERROR" });
  }
}

/** A guardrail blocked or rejected an operation. */
export class GuardrailError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "GUARDRAIL_ERROR" });
  }
}

/** A session storage adapter could not complete a persistence operation. */
export class StorageError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "STORAGE_ERROR" });
  }
}

/** A long-term memory adapter could not complete an operation. */
export class MemoryError extends EzAgentError {
  constructor(message: string, options: Omit<EzAgentErrorOptions, "code"> = {}) {
    super(message, { ...options, code: "MEMORY_ERROR" });
  }
}
