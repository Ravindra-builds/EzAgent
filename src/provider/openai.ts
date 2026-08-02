import { ProviderError } from "../errors";
import type {
  AssistantMessage,
  ChatMessage,
  MessageContent,
  Provider,
  ProviderCallOptions,
  ProviderCapabilities,
  ProviderChatRequest,
  ProviderFinishReason,
  ProviderResponse,
  ProviderStreamEvent,
  ProviderToolDefinition,
  ProviderUsage,
  ResponseFormat,
  ToolCall,
  ToolChoice
} from "../types";
import { getFiniteNumber, getString, isRecord } from "../utils";
import {
  joinUrl,
  parseServerSentEvents,
  parseSseJson,
  postJson,
  postSse,
  requireApiKey,
  requireBaseUrl,
  resolveFetch
} from "./internal";
import type { FetchImplementation } from "./internal";

const PROVIDER_ID = "openai";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Configuration for the direct OpenAI Chat Completions adapter. */
export interface OpenAIProviderConfig {
  /** An OpenAI API key. It is never added to errors or response metadata. */
  readonly apiKey: string;
  /** Override for compatible OpenAI-style endpoints. */
  readonly baseUrl?: string;
  /** Optional OpenAI organization identifier. */
  readonly organization?: string;
  /** Optional OpenAI project identifier. */
  readonly project?: string;
  /** Injectable transport, primarily useful for tests and nonstandard runtimes. */
  readonly fetch?: FetchImplementation;
}

/**
 * Provider adapter for OpenAI's Chat Completions HTTP API.
 *
 * The class translates EzAgent's provider-neutral request and response types;
 * no runtime or agent-framework behavior is embedded here.
 */
export class OpenAIProvider implements Provider {
  readonly id = PROVIDER_ID;
  readonly capabilities: ProviderCapabilities = {
    imageInput: true,
    streaming: true,
    structuredOutput: true,
    tools: true
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly organization: string | undefined;
  private readonly project: string | undefined;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = requireApiKey("OpenAI", config.apiKey);
    this.baseUrl = requireBaseUrl("OpenAI", config.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImplementation = resolveFetch(config.fetch);
    this.organization = nonEmpty(config.organization);
    this.project = nonEmpty(config.project);
  }

  async chat(
    request: ProviderChatRequest,
    options: ProviderCallOptions = {}
  ): Promise<ProviderResponse> {
    assertModel(request.model);
    const payload = buildOpenAIRequest(request, false);
    const response = await postJson<unknown>({
      fetch: this.fetchImplementation,
      headers: this.headers(),
      payload,
      provider: "OpenAI",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      url: joinUrl(this.baseUrl, "chat/completions")
    });

    return parseOpenAIResponse(response, request.model);
  }

  async *stream(
    request: ProviderChatRequest,
    options: ProviderCallOptions = {}
  ): AsyncGenerator<ProviderStreamEvent> {
    assertModel(request.model);
    const payload = buildOpenAIRequest(request, true);
    const response = await postSse({
      fetch: this.fetchImplementation,
      headers: this.headers(),
      payload,
      provider: "OpenAI",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      url: joinUrl(this.baseUrl, "chat/completions")
    });

    yield {
      model: request.model,
      provider: this.id,
      type: "response.start"
    };

    let id: string | undefined;
    let model = request.model;
    let text = "";
    let finishReason: ProviderFinishReason = "other";
    let usage: ProviderUsage | undefined;
    let sawPayload = false;
    let sawTerminalEvent = false;
    const toolCalls = new Map<number, MutableToolCall>();

    for await (const event of parseServerSentEvents(response, "OpenAI", options.signal)) {
      if (event.data === "[DONE]") {
        sawTerminalEvent = true;
        continue;
      }

      const chunk = parseOpenAIStreamChunk(parseSseJson(event, "OpenAI"));
      sawPayload = true;
      id ??= chunk.id;
      model = chunk.model ?? model;
      usage = chunk.usage ?? usage;

      if (chunk.text.length > 0) {
        text += chunk.text;
        yield {
          delta: chunk.text,
          provider: this.id,
          type: "text.delta"
        };
      }

      for (const delta of chunk.toolCalls) {
        const state = toolCalls.get(delta.index) ?? { arguments: "" };
        if (delta.id !== undefined) {
          state.id = delta.id;
        }
        if (delta.name !== undefined) {
          state.name = delta.name;
        }
        if (delta.argumentsDelta !== undefined) {
          state.arguments += delta.argumentsDelta;
        }
        toolCalls.set(delta.index, state);

        yield {
          provider: this.id,
          toolCall: {
            index: delta.index,
            ...(delta.id === undefined ? {} : { id: delta.id }),
            ...(delta.name === undefined ? {} : { name: delta.name }),
            ...(delta.argumentsDelta === undefined ? {} : { argumentsDelta: delta.argumentsDelta })
          },
          type: "tool-call.delta"
        };
      }

      if (chunk.finishReason !== undefined) {
        finishReason = chunk.finishReason;
        sawTerminalEvent = true;
      }
    }

    if (!sawPayload) {
      throw new ProviderError("OpenAI returned an empty streaming response.", {
        provider: "OpenAI",
        retryable: true
      });
    }
    if (!sawTerminalEvent) {
      throw new ProviderError("OpenAI streaming response ended before completion.", {
        provider: "OpenAI",
        retryable: true
      });
    }

    const completedToolCalls = completeToolCalls(toolCalls, "OpenAI");
    if (completedToolCalls.length > 0) {
      finishReason = "tool_calls";
    }

    const completed = createProviderResponse({
      finishReason,
      id,
      model,
      text,
      toolCalls: completedToolCalls,
      usage
    });

    yield {
      provider: this.id,
      response: completed,
      type: "response.completed"
    };
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`
    };

    if (this.organization !== undefined) {
      headers["OpenAI-Organization"] = this.organization;
    }
    if (this.project !== undefined) {
      headers["OpenAI-Project"] = this.project;
    }

    return headers;
  }
}

interface OpenAIRequestPayload {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  response_format?: OpenAIResponseFormat;
  stream?: boolean;
}

type OpenAIMessage =
  | {
      role: "system" | "user";
      content: OpenAIContent;
      name?: string;
    }
  | {
      role: "assistant";
      content: OpenAIContent;
      name?: string;
      tool_calls?: OpenAIToolCall[];
    }
  | {
      role: "tool";
      content: OpenAIContent;
      tool_call_id: string;
    };

type OpenAIContent = string | OpenAIContentPart[];

type OpenAIContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object;
    strict?: boolean;
  };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

type OpenAIToolChoice =
  | "auto"
  | "none"
  | "required"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

type OpenAIResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        schema: object;
        strict?: boolean;
      };
    };

function buildOpenAIRequest(request: ProviderChatRequest, stream: boolean): OpenAIRequestPayload {
  const payload: OpenAIRequestPayload = {
    messages: request.messages.map(mapOpenAIMessage),
    model: request.model
  };

  if (request.tools !== undefined && request.tools.length > 0) {
    payload.tools = request.tools.map(mapOpenAITool);
  }
  if (request.toolChoice !== undefined) {
    payload.tool_choice = mapOpenAIToolChoice(request.toolChoice);
  }
  if (request.temperature !== undefined) {
    payload.temperature = request.temperature;
  }
  if (request.topP !== undefined) {
    payload.top_p = request.topP;
  }
  if (request.maxOutputTokens !== undefined) {
    payload.max_tokens = request.maxOutputTokens;
  }
  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    payload.stop = [...request.stopSequences];
  }
  if (request.responseFormat !== undefined) {
    payload.response_format = mapOpenAIResponseFormat(request.responseFormat);
  }
  if (stream) {
    payload.stream = true;
  }

  return payload;
}

function mapOpenAIMessage(message: ChatMessage): OpenAIMessage {
  const content = mapOpenAIContent(message.content);

  switch (message.role) {
    case "system":
    case "user": {
      return {
        content,
        ...(message.name === undefined ? {} : { name: message.name }),
        role: message.role
      };
    }
    case "assistant": {
      return {
        content,
        ...(message.name === undefined ? {} : { name: message.name }),
        ...(message.toolCalls === undefined || message.toolCalls.length === 0
          ? {}
          : { tool_calls: message.toolCalls.map(mapOpenAIToolCall) }),
        role: "assistant"
      };
    }
    case "tool": {
      if (message.toolCallId.trim().length === 0) {
        throw new ProviderError("OpenAI tool messages require a toolCallId.", {
          provider: "OpenAI",
          retryable: false
        });
      }

      return {
        content,
        role: "tool",
        tool_call_id: message.toolCallId
      };
    }
  }
}

function mapOpenAIContent(content: MessageContent): OpenAIContent {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { text: part.text, type: "text" };
    }

    return {
      image_url: { url: part.imageUrl },
      type: "image_url"
    };
  });
}

function mapOpenAITool(tool: ProviderToolDefinition): OpenAITool {
  const definition: OpenAITool["function"] = {
    name: tool.name,
    parameters: tool.parameters
  };

  if (tool.description !== undefined) {
    definition.description = tool.description;
  }
  if (tool.strict !== undefined) {
    definition.strict = tool.strict;
  }

  return {
    function: definition,
    type: "function"
  };
}

function mapOpenAIToolCall(toolCall: ToolCall): OpenAIToolCall {
  return {
    function: {
      arguments: toolCall.arguments,
      name: toolCall.name
    },
    id: toolCall.id,
    type: "function"
  };
}

function mapOpenAIToolChoice(choice: ToolChoice): OpenAIToolChoice {
  if (typeof choice === "string") {
    return choice;
  }

  return {
    function: { name: choice.name },
    type: "function"
  };
}

function mapOpenAIResponseFormat(format: ResponseFormat): OpenAIResponseFormat {
  switch (format.type) {
    case "text":
      return { type: "text" };
    case "json_object":
      return { type: "json_object" };
    case "json_schema": {
      const schema: OpenAIResponseFormat = {
        json_schema: {
          name: format.name,
          schema: format.schema
        },
        type: "json_schema"
      };

      if (format.strict !== undefined && schema.type === "json_schema") {
        schema.json_schema.strict = format.strict;
      }

      return schema;
    }
  }
}

function parseOpenAIResponse(payload: unknown, requestedModel: string): ProviderResponse {
  const root = requireRecord(payload, "OpenAI returned a malformed response.");
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw invalidOpenAIResponse("OpenAI returned no completion choices.");
  }

  const choice = requireRecord(choices[0], "OpenAI returned an invalid completion choice.");
  const message = requireRecord(choice.message, "OpenAI completion did not include a message.");
  const toolCalls = parseOpenAIToolCalls(message.tool_calls);
  const content = parseOpenAIContent(message.content);
  const finishReason =
    toolCalls.length > 0 ? "tool_calls" : mapOpenAIFinishReason(choice.finish_reason);

  return createProviderResponse({
    finishReason,
    id: getString(root, "id"),
    model: getString(root, "model") ?? requestedModel,
    text: content,
    toolCalls,
    usage: parseOpenAIUsage(root.usage)
  });
}

interface OpenAIStreamToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly argumentsDelta?: string;
}

interface OpenAIStreamChunk {
  readonly id?: string;
  readonly model?: string;
  readonly text: string;
  readonly toolCalls: readonly OpenAIStreamToolCallDelta[];
  readonly finishReason?: ProviderFinishReason;
  readonly usage?: ProviderUsage;
}

function parseOpenAIStreamChunk(payload: unknown): OpenAIStreamChunk {
  const root = requireRecord(payload, "OpenAI sent an invalid streaming payload.");
  const choicesValue = root.choices;
  if (!Array.isArray(choicesValue)) {
    throw invalidOpenAIResponse("OpenAI streaming payload did not include choices.");
  }

  const choice = choicesValue.length > 0 ? asOptionalRecord(choicesValue[0]) : undefined;
  const delta = choice === undefined ? undefined : asOptionalRecord(choice.delta);
  const finishReason =
    choice === undefined ? undefined : mapOptionalOpenAIFinishReason(choice.finish_reason);
  const id = getString(root, "id");
  const model = getString(root, "model");
  const usage = parseOpenAIUsage(root.usage);

  return {
    ...(id === undefined ? {} : { id }),
    ...(model === undefined ? {} : { model }),
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
    text: delta === undefined ? "" : parseOpenAIContent(delta.content),
    toolCalls: delta === undefined ? [] : parseOpenAIStreamToolCallDeltas(delta.tool_calls)
  };
}

function parseOpenAIStreamToolCallDeltas(value: unknown): OpenAIStreamToolCallDelta[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidOpenAIResponse("OpenAI streamed an invalid tool call delta.");
  }

  const deltas: OpenAIStreamToolCallDelta[] = [];
  for (const [fallbackIndex, candidate] of value.entries()) {
    const record = requireRecord(candidate, "OpenAI streamed an invalid tool call delta.");
    const index = getFiniteNumber(record, "index") ?? fallbackIndex;
    if (!Number.isInteger(index) || index < 0) {
      throw invalidOpenAIResponse("OpenAI streamed a tool call delta with an invalid index.");
    }

    const functionDelta = asOptionalRecord(record.function);
    const id = getString(record, "id");
    const name = functionDelta === undefined ? undefined : getString(functionDelta, "name");
    const argumentsDelta =
      functionDelta === undefined ? undefined : getString(functionDelta, "arguments");

    deltas.push({
      index,
      ...(id === undefined ? {} : { id }),
      ...(name === undefined ? {} : { name }),
      ...(argumentsDelta === undefined ? {} : { argumentsDelta })
    });
  }

  return deltas;
}

function parseOpenAIToolCalls(value: unknown): ToolCall[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidOpenAIResponse("OpenAI returned invalid tool calls.");
  }

  return value.map((candidate, index) => {
    const record = requireRecord(candidate, "OpenAI returned an invalid tool call.");
    const functionCall = requireRecord(
      record.function,
      "OpenAI tool call did not include a function."
    );
    const name = getString(functionCall, "name");
    const argumentsValue = getString(functionCall, "arguments");
    if (name === undefined || argumentsValue === undefined) {
      throw invalidOpenAIResponse("OpenAI tool call did not include a name and argument string.");
    }

    return {
      arguments: argumentsValue,
      id: getString(record, "id") ?? `openai-call-${index}`,
      name
    };
  });
}

function parseOpenAIContent(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    throw invalidOpenAIResponse("OpenAI returned message content in an unsupported format.");
  }

  return value
    .map((part) => {
      const record = asOptionalRecord(part);
      return record === undefined ? "" : (getString(record, "text") ?? "");
    })
    .join("");
}

function parseOpenAIUsage(value: unknown): ProviderUsage | undefined {
  const usage = asOptionalRecord(value);
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = getFiniteNumber(usage, "prompt_tokens");
  const outputTokens = getFiniteNumber(usage, "completion_tokens");
  const totalTokens = getFiniteNumber(usage, "total_tokens");
  const promptDetails = asOptionalRecord(usage.prompt_tokens_details);
  const cachedInputTokens =
    promptDetails === undefined ? undefined : getFiniteNumber(promptDetails, "cached_tokens");

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedInputTokens === undefined
  ) {
    return undefined;
  }

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens })
  };
}

function createProviderResponse(input: {
  readonly id: string | undefined;
  readonly model: string;
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly finishReason: ProviderFinishReason;
  readonly usage: ProviderUsage | undefined;
}): ProviderResponse {
  const message: AssistantMessage = {
    content: input.text,
    ...(input.toolCalls.length === 0 ? {} : { toolCalls: input.toolCalls }),
    role: "assistant"
  };

  return {
    finishReason: input.finishReason,
    message,
    model: input.model,
    provider: PROVIDER_ID,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.usage === undefined ? {} : { usage: input.usage })
  };
}

function completeToolCalls(
  calls: ReadonlyMap<number, MutableToolCall>,
  provider: string
): ToolCall[] {
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => {
      if (call.name === undefined) {
        throw new ProviderError("OpenAI streamed a tool call without a name.", {
          metadata: { index },
          provider,
          retryable: false
        });
      }

      return {
        arguments: call.arguments,
        id: call.id ?? `openai-call-${index}`,
        name: call.name
      };
    });
}

interface MutableToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

function mapOpenAIFinishReason(value: unknown): ProviderFinishReason {
  return mapOptionalOpenAIFinishReason(value) ?? "other";
}

function mapOptionalOpenAIFinishReason(value: unknown): ProviderFinishReason | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value) {
    case "stop":
      return "stop";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    default:
      return "other";
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidOpenAIResponse(message);
  }

  return value;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function invalidOpenAIResponse(message: string): ProviderError {
  return new ProviderError(message, {
    provider: "OpenAI",
    retryable: false
  });
}

function assertModel(model: string): void {
  if (model.trim().length === 0) {
    throw new ProviderError("OpenAI requires a non-empty model name.", {
      provider: "OpenAI",
      retryable: false
    });
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}
