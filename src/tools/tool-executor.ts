import { TimeoutError, ToolError } from "../errors";
import { safeErrorMessage } from "../utils";
import { invokeTool, isEzAgentTool } from "./registry";
import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionOptions,
  ToolExecutionResult,
  ToolExecutorConfig
} from "./types";

/**
 * Executes one registered tool invocation.
 *
 * This class owns argument parsing, Zod validation, cancellation, deadlines,
 * result serialization, and conversion of arbitrary callback failures into
 * useful EzAgent errors. Runtime events remain the Runner's responsibility.
 */
export class ToolExecutor {
  private readonly defaultTimeoutMs: number | undefined;

  constructor(config: ToolExecutorConfig = {}) {
    if (typeof config !== "object" || config === null) {
      throw new ToolError("ToolExecutor configuration must be an object.");
    }
    if (
      config.defaultTimeoutMs !== undefined &&
      (!Number.isSafeInteger(config.defaultTimeoutMs) || config.defaultTimeoutMs <= 0)
    ) {
      throw new ToolError("ToolExecutor defaultTimeoutMs must be a positive integer.", {
        metadata: { field: "defaultTimeoutMs" }
      });
    }

    this.defaultTimeoutMs = config.defaultTimeoutMs;
  }

  /** Validates and executes a model-requested tool call. */
  async execute<TContext = unknown>(
    tool: Tool,
    options: ToolExecutionOptions<TContext>
  ): Promise<ToolExecutionResult> {
    validateExecutionInput(tool, options);
    const startedAt = Date.now();
    const input = parseArguments(tool, options.toolCall.arguments, options.toolCall.id);
    const validated = tool.schema.safeParse(input);
    if (!validated.success) {
      throw new ToolError(`Tool "${tool.name}" received invalid arguments.`, {
        metadata: {
          issues: validated.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.join(".")
          })),
          phase: "validation",
          toolCallId: options.toolCall.id,
          toolName: tool.name
        }
      });
    }

    const timeoutMs = options.timeoutMs ?? tool.timeoutMs ?? this.defaultTimeoutMs;
    const deadline = createDeadline(options.signal, timeoutMs);
    const context: ToolExecutionContext<TContext> = {
      agentName: options.agentName,
      context: options.context,
      runId: options.runId,
      signal: deadline.signal,
      toolCallId: options.toolCall.id
    };

    try {
      const value = await awaitWithSignal(
        invokeTool(tool, validated.data, context as unknown as ToolExecutionContext<unknown>),
        deadline.signal
      );
      const output = serializeResult(tool, options.toolCall.id, value);

      return {
        durationMs: Date.now() - startedAt,
        output,
        toolCallId: options.toolCall.id,
        toolName: tool.name,
        value
      };
    } catch (cause) {
      if (deadline.didTimeout()) {
        throw new TimeoutError(
          `Tool "${tool.name}" exceeded its ${String(timeoutMs)}ms execution timeout.`,
          {
            cause,
            metadata: {
              timeoutMs,
              toolCallId: options.toolCall.id,
              toolName: tool.name
            }
          }
        );
      }
      if (options.signal?.aborted === true) {
        throw new ToolError(`Tool "${tool.name}" execution was aborted.`, {
          cause,
          metadata: {
            phase: "cancelled",
            toolCallId: options.toolCall.id,
            toolName: tool.name
          }
        });
      }
      if (cause instanceof ToolError || cause instanceof TimeoutError) {
        throw cause;
      }

      throw new ToolError(`Tool "${tool.name}" failed: ${safeErrorMessage(cause)}.`, {
        cause,
        metadata: {
          phase: "execution",
          toolCallId: options.toolCall.id,
          toolName: tool.name
        }
      });
    } finally {
      deadline.dispose();
    }
  }
}

function validateExecutionInput<TContext>(
  tool: Tool,
  options: ToolExecutionOptions<TContext>
): void {
  if (!isEzAgentTool(tool)) {
    throw new ToolError("ToolExecutor can only execute tools created with EzAgent.tool().");
  }
  if (typeof options !== "object" || options === null) {
    throw new ToolError("Tool execution options must be an object.");
  }
  if (typeof options.agentName !== "string" || options.agentName.trim().length === 0) {
    throw new ToolError("Tool execution requires a non-empty agentName.", {
      metadata: { field: "agentName", toolName: tool.name }
    });
  }
  if (typeof options.runId !== "string" || options.runId.trim().length === 0) {
    throw new ToolError("Tool execution requires a non-empty runId.", {
      metadata: { field: "runId", toolName: tool.name }
    });
  }
  if (
    typeof options.toolCall !== "object" ||
    options.toolCall === null ||
    typeof options.toolCall.id !== "string" ||
    options.toolCall.id.trim().length === 0 ||
    typeof options.toolCall.name !== "string" ||
    options.toolCall.name.trim().length === 0 ||
    typeof options.toolCall.arguments !== "string"
  ) {
    throw new ToolError("Tool execution requires a valid model tool call.", {
      metadata: { field: "toolCall", toolName: tool.name }
    });
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw new ToolError("Tool execution timeoutMs must be a positive integer.", {
      metadata: { field: "timeoutMs", toolName: tool.name }
    });
  }
  if (
    options.signal !== undefined &&
    (typeof options.signal !== "object" ||
      typeof options.signal.aborted !== "boolean" ||
      typeof options.signal.addEventListener !== "function")
  ) {
    throw new ToolError("Tool execution signal must be an AbortSignal.", {
      metadata: { field: "signal", toolName: tool.name }
    });
  }
}

function parseArguments(tool: Tool, rawArguments: string, toolCallId: string): unknown {
  try {
    return JSON.parse(rawArguments) as unknown;
  } catch (cause) {
    throw new ToolError(`Tool "${tool.name}" received malformed JSON arguments.`, {
      cause,
      metadata: {
        phase: "parse",
        toolCallId,
        toolName: tool.name
      }
    });
  }
}

function serializeResult(tool: Tool, toolCallId: string, value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? "null";
  } catch (cause) {
    throw new ToolError(`Tool "${tool.name}" returned a value that cannot be serialized.`, {
      cause,
      metadata: {
        phase: "serialization",
        toolCallId,
        toolName: tool.name
      }
    });
  }
}

interface Deadline {
  readonly signal: AbortSignal;
  readonly didTimeout: () => boolean;
  readonly dispose: () => void;
}

function createDeadline(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  if (timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Tool execution timed out."));
    }, timeoutMs);
  }

  return {
    didTimeout: () => timedOut,
    dispose: () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal
  };
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Operation was aborted."));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(signal.reason ?? new Error("Operation was aborted."));
    };
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}
