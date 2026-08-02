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

const PROVIDER_ID = "gemini";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/** Configuration for the direct Gemini Generative Language REST adapter. */
export interface GeminiProviderConfig {
  /** A Gemini API key. It is sent as a header and never emitted in errors. */
  readonly apiKey: string;
  /** Override for a compatible Gemini Generative Language endpoint. */
  readonly baseUrl?: string;
  /** Injectable transport, primarily useful for tests and nonstandard runtimes. */
  readonly fetch?: FetchImplementation;
}

/**
 * Provider adapter for Gemini's Generative Language REST API.
 *
 * Gemini function-response messages need a function name, so every EzAgent
 * `ToolMessage` carries that name in addition to its provider-neutral call id.
 */
export class GeminiProvider implements Provider {
  readonly id = PROVIDER_ID;
  readonly capabilities: ProviderCapabilities = {
    imageInput: false,
    streaming: true,
    structuredOutput: true,
    tools: true
  };

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = requireApiKey("Gemini", config.apiKey);
    this.baseUrl = requireBaseUrl("Gemini", config.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImplementation = resolveFetch(config.fetch);
  }

  async chat(
    request: ProviderChatRequest,
    options: ProviderCallOptions = {}
  ): Promise<ProviderResponse> {
    assertModel(request.model);
    const response = await postJson<unknown>({
      fetch: this.fetchImplementation,
      headers: this.headers(),
      payload: buildGeminiRequest(request),
      provider: "Gemini",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      url: this.endpoint(request.model, "generateContent")
    });

    return parseGeminiResponse(response, request.model);
  }

  async *stream(
    request: ProviderChatRequest,
    options: ProviderCallOptions = {}
  ): AsyncGenerator<ProviderStreamEvent> {
    assertModel(request.model);
    const response = await postSse({
      fetch: this.fetchImplementation,
      headers: this.headers(),
      payload: buildGeminiRequest(request),
      provider: "Gemini",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      url: `${this.endpoint(request.model, "streamGenerateContent")}?alt=sse`
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
    const toolCalls = new Map<number, MutableGeminiToolCall>();

    for await (const event of parseServerSentEvents(response, "Gemini", options.signal)) {
      if (event.data === "[DONE]") {
        continue;
      }

      const chunk = parseGeminiStreamChunk(parseSseJson(event, "Gemini"));
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
        if (delta.arguments !== undefined) {
          // Gemini delivers function-call arguments as an object, not token fragments.
          state.arguments = delta.arguments;
        }
        toolCalls.set(delta.index, state);

        yield {
          provider: this.id,
          toolCall: {
            index: delta.index,
            ...(delta.id === undefined ? {} : { id: delta.id }),
            ...(delta.name === undefined ? {} : { name: delta.name }),
            ...(delta.arguments === undefined ? {} : { argumentsDelta: delta.arguments })
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
      throw new ProviderError("Gemini returned an empty streaming response.", {
        provider: "Gemini",
        retryable: true
      });
    }
    if (!sawTerminalEvent) {
      throw new ProviderError("Gemini streaming response ended before completion.", {
        provider: "Gemini",
        retryable: true
      });
    }

    const completedToolCalls = completeToolCalls(toolCalls);
    if (completedToolCalls.length > 0) {
      finishReason = "tool_calls";
    }

    const completed = createGeminiResponse({
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
    return { "x-goog-api-key": this.apiKey };
  }

  private endpoint(model: string, operation: "generateContent" | "streamGenerateContent"): string {
    const normalizedModel = model.replace(/^models\//, "");
    return joinUrl(this.baseUrl, `models/${encodeURIComponent(normalizedModel)}:${operation}`);
  }
}

interface GeminiRequestPayload {
  contents: GeminiContent[];
  systemInstruction?: {
    parts: GeminiPart[];
  };
  tools?: GeminiTool[];
  toolConfig?: GeminiToolConfig;
  generationConfig?: GeminiGenerationConfig;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

type GeminiPart =
  | {
      text: string;
    }
  | {
      functionCall: {
        name: string;
        args: Record<string, unknown>;
      };
    }
  | {
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    };

interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters: object;
}

interface GeminiToolConfig {
  functionCallingConfig: {
    mode: "AUTO" | "NONE" | "ANY";
    allowedFunctionNames?: string[];
  };
}

interface GeminiGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  responseMimeType?: "application/json";
  responseJsonSchema?: object;
}

function buildGeminiRequest(request: ProviderChatRequest): GeminiRequestPayload {
  const systemMessages = request.messages.filter((message) => message.role === "system");
  const conversation = request.messages.filter((message) => message.role !== "system");
  const payload: GeminiRequestPayload = {
    contents: conversation.map(mapGeminiMessage)
  };

  if (systemMessages.length > 0) {
    const parts = systemMessages.flatMap((message) =>
      toGeminiTextParts(message.content, "Gemini system instructions")
    );
    payload.systemInstruction = {
      parts: parts.length === 0 ? [{ text: "" }] : parts
    };
  }

  if (request.tools !== undefined && request.tools.length > 0) {
    payload.tools = [
      {
        functionDeclarations: request.tools.map(mapGeminiTool)
      }
    ];
  }
  if (request.toolChoice !== undefined) {
    payload.toolConfig = mapGeminiToolChoice(request.toolChoice);
  }

  const generationConfig = buildGenerationConfig(request);
  if (generationConfig !== undefined) {
    payload.generationConfig = generationConfig;
  }

  return payload;
}

function mapGeminiMessage(
  message: Exclude<ChatMessage, { readonly role: "system" }>
): GeminiContent {
  switch (message.role) {
    case "user":
      return {
        parts: ensureParts(toGeminiTextParts(message.content, "Gemini user messages")),
        role: "user"
      };
    case "assistant": {
      const parts = toGeminiTextParts(message.content, "Gemini assistant messages");
      if (message.toolCalls !== undefined) {
        for (const toolCall of message.toolCalls) {
          parts.push({
            functionCall: {
              args: parseFunctionArguments(toolCall),
              name: toolCall.name
            }
          });
        }
      }

      return {
        parts: ensureParts(parts),
        role: "model"
      };
    }
    case "tool":
      return {
        parts: [
          {
            functionResponse: {
              name: message.name,
              response: parseToolResponse(message.content)
            }
          }
        ],
        role: "user"
      };
  }
}

function toGeminiTextParts(content: MessageContent, context: string): GeminiPart[] {
  if (typeof content === "string") {
    return [{ text: content }];
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { text: part.text };
    }

    throw new ProviderError(`${context} do not support image_url content in GeminiProvider.`, {
      provider: "Gemini",
      retryable: false
    });
  });
}

function ensureParts(parts: GeminiPart[]): GeminiPart[] {
  return parts.length === 0 ? [{ text: "" }] : parts;
}

function mapGeminiTool(tool: ProviderToolDefinition): GeminiFunctionDeclaration {
  const declaration: GeminiFunctionDeclaration = {
    name: tool.name,
    parameters: tool.parameters
  };

  if (tool.description !== undefined) {
    declaration.description = tool.description;
  }

  return declaration;
}

function mapGeminiToolChoice(choice: ToolChoice): GeminiToolConfig {
  if (typeof choice === "string") {
    switch (choice) {
      case "auto":
        return { functionCallingConfig: { mode: "AUTO" } };
      case "none":
        return { functionCallingConfig: { mode: "NONE" } };
      case "required":
        return { functionCallingConfig: { mode: "ANY" } };
    }
  }

  return {
    functionCallingConfig: {
      allowedFunctionNames: [choice.name],
      mode: "ANY"
    }
  };
}

function buildGenerationConfig(request: ProviderChatRequest): GeminiGenerationConfig | undefined {
  const config: GeminiGenerationConfig = {};

  if (request.temperature !== undefined) {
    config.temperature = request.temperature;
  }
  if (request.topP !== undefined) {
    config.topP = request.topP;
  }
  if (request.maxOutputTokens !== undefined) {
    config.maxOutputTokens = request.maxOutputTokens;
  }
  if (request.stopSequences !== undefined && request.stopSequences.length > 0) {
    config.stopSequences = [...request.stopSequences];
  }
  if (request.responseFormat !== undefined) {
    applyResponseFormat(config, request.responseFormat);
  }

  return Object.keys(config).length === 0 ? undefined : config;
}

function applyResponseFormat(config: GeminiGenerationConfig, format: ResponseFormat): void {
  switch (format.type) {
    case "text":
      return;
    case "json_object":
      config.responseMimeType = "application/json";
      return;
    case "json_schema":
      config.responseMimeType = "application/json";
      config.responseJsonSchema = format.schema;
      return;
  }
}

function parseGeminiResponse(payload: unknown, requestedModel: string): ProviderResponse {
  const root = requireRecord(payload, "Gemini returned a malformed response.");
  const candidates = root.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return createGeminiResponse({
      finishReason: hasPromptBlock(root) ? "content_filter" : "other",
      id: getString(root, "responseId"),
      model: getString(root, "modelVersion") ?? requestedModel,
      text: "",
      toolCalls: [],
      usage: parseGeminiUsage(root.usageMetadata)
    });
  }

  const candidate = requireRecord(candidates[0], "Gemini returned an invalid response candidate.");
  const content = asOptionalRecord(candidate.content);
  const parts: { text: string; toolCalls: ToolCall[] } =
    content === undefined ? { text: "", toolCalls: [] } : parseGeminiParts(content.parts);
  const finishReason =
    parts.toolCalls.length > 0 ? "tool_calls" : mapGeminiFinishReason(candidate.finishReason);

  return createGeminiResponse({
    finishReason,
    id: getString(root, "responseId"),
    model: getString(root, "modelVersion") ?? requestedModel,
    text: parts.text,
    toolCalls: parts.toolCalls,
    usage: parseGeminiUsage(root.usageMetadata)
  });
}

interface GeminiStreamToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: string;
}

interface GeminiStreamChunk {
  readonly id?: string;
  readonly model?: string;
  readonly text: string;
  readonly toolCalls: readonly GeminiStreamToolCallDelta[];
  readonly finishReason?: ProviderFinishReason;
  readonly usage?: ProviderUsage;
}

function parseGeminiStreamChunk(payload: unknown): GeminiStreamChunk {
  const root = requireRecord(payload, "Gemini sent an invalid streaming payload.");
  const candidates = root.candidates;
  const candidate =
    Array.isArray(candidates) && candidates.length > 0
      ? asOptionalRecord(candidates[0])
      : undefined;
  const content = candidate === undefined ? undefined : asOptionalRecord(candidate.content);
  const parsedParts: { text: string; toolCalls: ToolCall[] } =
    content === undefined ? { text: "", toolCalls: [] } : parseGeminiParts(content.parts);
  const finishReason =
    parsedParts.toolCalls.length > 0
      ? "tool_calls"
      : candidate === undefined
        ? hasPromptBlock(root)
          ? "content_filter"
          : undefined
        : mapOptionalGeminiFinishReason(candidate.finishReason);
  const id = getString(root, "responseId");
  const model = getString(root, "modelVersion");
  const usage = parseGeminiUsage(root.usageMetadata);

  return {
    ...(id === undefined ? {} : { id }),
    ...(model === undefined ? {} : { model }),
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
    text: parsedParts.text,
    toolCalls: parsedParts.toolCalls.map((toolCall, index) => ({
      arguments: toolCall.arguments,
      id: toolCall.id,
      index,
      name: toolCall.name
    }))
  };
}

function parseGeminiParts(value: unknown): { text: string; toolCalls: ToolCall[] } {
  if (value === undefined || value === null) {
    return { text: "", toolCalls: [] };
  }
  if (!Array.isArray(value)) {
    throw invalidGeminiResponse("Gemini returned content parts in an unsupported format.");
  }

  let text = "";
  const toolCalls: ToolCall[] = [];

  for (const [index, candidate] of value.entries()) {
    const part = requireRecord(candidate, "Gemini returned an invalid content part.");
    const textPart = getString(part, "text");
    if (textPart !== undefined) {
      text += textPart;
    }

    const functionCall = asOptionalRecord(part.functionCall);
    if (functionCall !== undefined) {
      const name = getString(functionCall, "name");
      if (name === undefined) {
        throw invalidGeminiResponse("Gemini returned a function call without a name.");
      }

      toolCalls.push({
        arguments: stringifyFunctionArguments(functionCall.args),
        id: getString(functionCall, "id") ?? `gemini-call-${index}`,
        name
      });
    }
  }

  return { text, toolCalls };
}

function parseFunctionArguments(toolCall: ToolCall): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolCall.arguments) as unknown;
  } catch (cause) {
    throw new ProviderError(
      `Gemini cannot replay tool call "${toolCall.name}" because its arguments are not valid JSON.`,
      {
        cause,
        provider: "Gemini",
        retryable: false
      }
    );
  }

  if (!isRecord(parsed)) {
    throw new ProviderError(
      `Gemini cannot replay tool call "${toolCall.name}" because its arguments are not a JSON object.`,
      {
        provider: "Gemini",
        retryable: false
      }
    );
  }

  return parsed;
}

function parseToolResponse(content: MessageContent): Record<string, unknown> {
  const text = contentToText(content);
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) {
      return parsed;
    }

    return { result: parsed };
  } catch {
    return { result: text };
  }
}

function contentToText(content: MessageContent): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      throw new ProviderError("Gemini tool responses do not support image_url content.", {
        provider: "Gemini",
        retryable: false
      });
    })
    .join("");
}

function stringifyFunctionArguments(value: unknown): string {
  if (value === undefined || value === null) {
    return "{}";
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "{}";
  } catch (cause) {
    throw new ProviderError("Gemini returned function arguments that could not be serialized.", {
      cause,
      provider: "Gemini",
      retryable: false
    });
  }
}

function parseGeminiUsage(value: unknown): ProviderUsage | undefined {
  const usage = asOptionalRecord(value);
  if (usage === undefined) {
    return undefined;
  }

  const inputTokens = getFiniteNumber(usage, "promptTokenCount");
  const outputTokens = getFiniteNumber(usage, "candidatesTokenCount");
  const totalTokens = getFiniteNumber(usage, "totalTokenCount");
  const cachedInputTokens = getFiniteNumber(usage, "cachedContentTokenCount");

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

function createGeminiResponse(input: {
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

function completeToolCalls(calls: ReadonlyMap<number, MutableGeminiToolCall>): ToolCall[] {
  return [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => {
      if (call.name === undefined) {
        throw new ProviderError("Gemini streamed a function call without a name.", {
          metadata: { index },
          provider: "Gemini",
          retryable: false
        });
      }

      return {
        arguments: call.arguments,
        id: call.id ?? `gemini-call-${index}`,
        name: call.name
      };
    });
}

interface MutableGeminiToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

function hasPromptBlock(root: Record<string, unknown>): boolean {
  const promptFeedback = asOptionalRecord(root.promptFeedback);
  return promptFeedback !== undefined && getString(promptFeedback, "blockReason") !== undefined;
}

function mapGeminiFinishReason(value: unknown): ProviderFinishReason {
  return mapOptionalGeminiFinishReason(value) ?? "other";
}

function mapOptionalGeminiFinishReason(value: unknown): ProviderFinishReason | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    default:
      return "other";
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidGeminiResponse(message);
  }

  return value;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function invalidGeminiResponse(message: string): ProviderError {
  return new ProviderError(message, {
    provider: "Gemini",
    retryable: false
  });
}

function assertModel(model: string): void {
  if (model.trim().length === 0) {
    throw new ProviderError("Gemini requires a non-empty model name.", {
      provider: "Gemini",
      retryable: false
    });
  }
}
