import type {
  Provider,
  ProviderCallOptions,
  ProviderCapabilities,
  ProviderChatRequest,
  ProviderResponse,
  ProviderStreamEvent,
  ToolCall
} from "../../src";

export type MockProviderStep =
  | ProviderResponse
  | ((
      request: ProviderChatRequest,
      options: ProviderCallOptions | undefined
    ) => ProviderResponse | Promise<ProviderResponse>);

export type MockStreamStep =
  | readonly ProviderStreamEvent[]
  | ((
      request: ProviderChatRequest,
      options: ProviderCallOptions | undefined
    ) => AsyncIterable<ProviderStreamEvent> | Promise<AsyncIterable<ProviderStreamEvent>>);

export interface MockProviderConfig {
  readonly chat?: readonly MockProviderStep[];
  readonly stream?: readonly MockStreamStep[];
  readonly capabilities?: Partial<ProviderCapabilities>;
}

/**
 * Reusable deterministic Provider for unit and integration tests.
 *
 * It supports text responses, tool calls, invalid-output text, errors,
 * timeout simulation, and scripted provider stream events without network I/O.
 */
export class MockProvider implements Provider {
  readonly id = "mock";
  readonly capabilities: ProviderCapabilities;
  readonly requests: ProviderChatRequest[] = [];
  readonly streamRequests: ProviderChatRequest[] = [];

  private readonly chatSteps: MockProviderStep[];
  private readonly streamSteps: MockStreamStep[];

  constructor(config: MockProviderConfig | readonly MockProviderStep[] = {}) {
    const normalized: MockProviderConfig = Array.isArray(config)
      ? { chat: config as readonly MockProviderStep[] }
      : (config as MockProviderConfig);
    this.chatSteps = [...(normalized.chat ?? [])];
    this.streamSteps = [...(normalized.stream ?? [])];
    this.capabilities = {
      imageInput: false,
      streaming: true,
      structuredOutput: true,
      tools: true,
      ...normalized.capabilities
    };
  }

  async chat(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): Promise<ProviderResponse> {
    this.requests.push(request);
    const step = this.chatSteps.shift();
    if (step === undefined) {
      throw new Error("MockProvider received more chat calls than configured.");
    }

    return typeof step === "function" ? step(request, options) : step;
  }

  async *stream(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    this.streamRequests.push(request);
    const step = this.streamSteps.shift();
    if (step === undefined) {
      throw new Error("MockProvider received more stream calls than configured.");
    }

    const events =
      typeof step === "function" ? await step(request, options) : streamFromEvents(step);
    for await (const event of events) {
      yield event;
    }
  }

  static text(content: string): ProviderResponse {
    return assistantResponse(content);
  }

  static toolCalls(toolCalls: readonly ToolCall[]): ProviderResponse {
    return assistantResponse("", toolCalls);
  }

  /** A text response intended to fail an Agent structured-output schema. */
  static invalidOutput(content = "not valid JSON"): ProviderResponse {
    return assistantResponse(content);
  }

  static error(error: Error): MockProviderStep {
    return () => {
      throw error;
    };
  }

  /** Never resolves unless Runner cancellation/timeout ends the surrounding operation. */
  static timeout(): MockProviderStep {
    return (_request, options) =>
      new Promise<ProviderResponse>((_resolve, reject) => {
        if (options?.signal?.aborted === true) {
          reject(options.signal.reason ?? new Error("MockProvider timeout aborted."));
          return;
        }
        options?.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason ?? new Error("MockProvider timeout aborted.")),
          { once: true }
        );
      });
  }

  static streamEvents(events: readonly ProviderStreamEvent[]): MockStreamStep {
    return Object.freeze([...events]);
  }
}

export function assistantResponse(
  content: string,
  toolCalls: readonly ToolCall[] = []
): ProviderResponse {
  return {
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    message: {
      content,
      role: "assistant",
      ...(toolCalls.length === 0 ? {} : { toolCalls })
    },
    model: "mock-model",
    provider: "mock"
  };
}

async function* streamFromEvents(
  events: readonly ProviderStreamEvent[]
): AsyncGenerator<ProviderStreamEvent> {
  for (const event of events) {
    yield event;
  }
}
