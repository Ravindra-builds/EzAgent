import { Agent, GeminiProvider, OpenAIProvider, ProviderError, Runner } from "ezagent";
import type {
  Provider,
  ProviderCallOptions,
  ProviderCapabilities,
  ProviderChatRequest,
  ProviderResponse,
  ProviderStreamEvent
} from "ezagent";

const openAiKey = process.env.OPENAI_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
if (openAiKey === undefined || geminiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY and GEMINI_API_KEY before running this example.");
}

class FallbackProvider implements Provider {
  readonly id = "fallback";
  readonly capabilities: ProviderCapabilities = {
    imageInput: false,
    streaming: true,
    structuredOutput: true,
    tools: true
  };

  constructor(
    private readonly providers: readonly { readonly provider: Provider; readonly model: string }[]
  ) {}

  async chat(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): Promise<ProviderResponse> {
    let lastError: Error | undefined;
    for (const candidate of this.providers) {
      try {
        return await candidate.provider.chat({ ...request, model: candidate.model }, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!(error instanceof ProviderError) || !error.retryable) {
          throw error;
        }
      }
    }
    throw lastError ?? new Error("No fallback provider was configured.");
  }

  async *stream(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    let lastError: Error | undefined;
    for (const candidate of this.providers) {
      try {
        yield* candidate.provider.stream({ ...request, model: candidate.model }, options);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!(error instanceof ProviderError) || !error.retryable) {
          throw error;
        }
      }
    }
    throw lastError ?? new Error("No fallback provider was configured.");
  }
}

const provider = new FallbackProvider([
  { model: "gpt-4.1-mini", provider: new OpenAIProvider({ apiKey: openAiKey }) },
  { model: "gemini-2.0-flash", provider: new GeminiProvider({ apiKey: geminiKey }) }
]);
const agent = new Agent({
  instructions: "Answer concisely.",
  model: "fallback",
  name: "Fallback Assistant",
  provider
});

const result = await new Runner({
  retry: { initialDelayMs: 250, maxAttempts: 3 }
}).run(agent, { input: "Explain why provider fallbacks are useful." });

console.log(result.output);
