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

/** Deterministic Provider implementation for runner tests; it performs no I/O. */
export class MockProvider implements Provider {
  readonly id = "mock";
  readonly capabilities: ProviderCapabilities = {
    imageInput: false,
    streaming: true,
    structuredOutput: true,
    tools: true
  };
  readonly requests: ProviderChatRequest[] = [];

  private readonly steps: MockProviderStep[];

  constructor(steps: readonly MockProviderStep[]) {
    this.steps = [...steps];
  }

  async chat(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): Promise<ProviderResponse> {
    this.requests.push(request);
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error("MockProvider received more chat calls than configured.");
    }

    return typeof step === "function" ? step(request, options) : step;
  }

  stream(
    _request: ProviderChatRequest,
    _options?: ProviderCallOptions
  ): AsyncIterable<ProviderStreamEvent> {
    throw new Error("MockProvider.stream is not used by these runtime tests.");
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
