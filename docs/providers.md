# Provider adapters

EzAgent exposes one provider-neutral interface:

```ts
interface Provider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  chat(request: ProviderChatRequest, options?: ProviderCallOptions): Promise<ProviderResponse>;
  stream(
    request: ProviderChatRequest,
    options?: ProviderCallOptions
  ): AsyncIterable<ProviderStreamEvent>;
}
```

The first release of this interface has direct HTTP adapters for OpenAI Chat Completions and the Gemini Generative Language REST API. They are intentionally isolated from `Runner`, so future adapters (Anthropic, Ollama, OpenRouter, or an in-house endpoint) only need to implement this contract.

## OpenAI

```ts
import { OpenAIProvider } from "ezagent";

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  organization: "org_optional",
  project: "proj_optional"
});
```

`OpenAIProvider` sends requests to `https://api.openai.com/v1/chat/completions` by default. Set `baseUrl` for a compatible endpoint. It supports text/image URL message parts, tools, JSON response formats, and SSE streaming.

## Gemini

```ts
import { GeminiProvider } from "ezagent";

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!
});
```

`GeminiProvider` sends requests to Gemini's v1beta Generative Language API by default. It supports text messages, function calls/responses, JSON response formats, and SSE streaming. Its advertised `imageInput` capability is `false` in this milestone because a generic remote `image_url` cannot safely be translated to Gemini's upload/inline-media model.

Gemini function responses require a function name. Therefore, a normalized `ToolMessage` includes both `toolCallId` and `name`.

## Cancellation and testing

Pass an `AbortSignal` to either operation:

```ts
const controller = new AbortController();
const response = await provider.chat(request, { signal: controller.signal });
```

Every provider config accepts a `fetch` implementation. This makes deterministic unit tests possible without making network calls:

```ts
const provider = new OpenAIProvider({
  apiKey: "test-key",
  fetch: async () => new Response(JSON.stringify(mockPayload))
});
```
