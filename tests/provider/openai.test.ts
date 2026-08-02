import { describe, expect, it } from "vitest";

import { ProviderError } from "../../src/errors";
import { OpenAIProvider } from "../../src/provider";
import type { FetchImplementation, ProviderChatRequest, ProviderStreamEvent } from "../../src";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status
  });
}

function sseResponse(payloads: readonly (unknown | "[DONE]")[]): Response {
  const body = payloads
    .map(
      (payload) => `data: ${typeof payload === "string" ? payload : JSON.stringify(payload)}\n\n`
    )
    .join("");
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
    status: 200
  });
}

describe("OpenAIProvider", () => {
  it("translates a normalized chat request and response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetch: FetchImplementation = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              role: "assistant",
              tool_calls: [
                {
                  function: {
                    arguments: '{"city":"Ranchi"}',
                    name: "weather"
                  },
                  id: "call_weather",
                  type: "function"
                }
              ]
            }
          }
        ],
        id: "chatcmpl_123",
        model: "gpt-test",
        usage: {
          completion_tokens: 9,
          prompt_tokens: 12,
          total_tokens: 21
        }
      });
    };

    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      organization: "org_123",
      project: "proj_123",
      fetch
    });
    const request = {
      messages: [
        { content: "Be concise.", role: "system" },
        { content: "What is the weather?", role: "user" }
      ],
      model: "gpt-test",
      responseFormat: {
        name: "weather_answer",
        schema: {
          properties: { summary: { type: "string" } },
          required: ["summary"],
          type: "object"
        },
        strict: true,
        type: "json_schema"
      },
      toolChoice: { name: "weather", type: "tool" },
      tools: [
        {
          description: "Looks up the weather.",
          name: "weather",
          parameters: {
            properties: { city: { type: "string" } },
            required: ["city"],
            type: "object"
          },
          strict: true
        }
      ]
    } satisfies ProviderChatRequest;

    const result = await provider.chat(request);

    expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(capturedInit?.headers).toMatchObject({
      Authorization: "Bearer test-openai-key",
      "OpenAI-Organization": "org_123",
      "OpenAI-Project": "proj_123"
    });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      messages: [
        { content: "Be concise.", role: "system" },
        { content: "What is the weather?", role: "user" }
      ],
      model: "gpt-test",
      response_format: {
        json_schema: {
          name: "weather_answer",
          strict: true
        },
        type: "json_schema"
      },
      tool_choice: {
        function: { name: "weather" },
        type: "function"
      },
      tools: [
        {
          function: {
            name: "weather",
            strict: true
          },
          type: "function"
        }
      ]
    });
    expect(result).toEqual({
      finishReason: "tool_calls",
      id: "chatcmpl_123",
      message: {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: '{"city":"Ranchi"}',
            id: "call_weather",
            name: "weather"
          }
        ]
      },
      model: "gpt-test",
      provider: "openai",
      usage: {
        inputTokens: 12,
        outputTokens: 9,
        totalTokens: 21
      }
    });
  });

  it("normalizes streaming text and incremental tool calls", async () => {
    const fetch: FetchImplementation = async () =>
      sseResponse([
        {
          choices: [
            {
              delta: { content: "Checking " },
              index: 0
            }
          ],
          id: "chatcmpl_stream",
          model: "gpt-test"
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: {
                      arguments: '{"city":"',
                      name: "weather"
                    },
                    id: "call_1",
                    index: 0,
                    type: "function"
                  }
                ]
              },
              index: 0
            }
          ],
          id: "chatcmpl_stream",
          model: "gpt-test"
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    function: { arguments: 'Ranchi"}' },
                    index: 0,
                    type: "function"
                  }
                ]
              },
              finish_reason: "tool_calls",
              index: 0
            }
          ],
          id: "chatcmpl_stream",
          model: "gpt-test",
          usage: {
            completion_tokens: 7,
            prompt_tokens: 5,
            total_tokens: 12
          }
        },
        "[DONE]"
      ]);
    const provider = new OpenAIProvider({ apiKey: "test-openai-key", fetch });
    const events: ProviderStreamEvent[] = [];

    for await (const event of provider.stream({
      messages: [{ content: "Check Ranchi weather", role: "user" }],
      model: "gpt-test"
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ type: "response.start" });
    expect(events[1]).toEqual({
      delta: "Checking ",
      provider: "openai",
      type: "text.delta"
    });
    expect(events[2]).toMatchObject({
      toolCall: {
        argumentsDelta: '{"city":"',
        id: "call_1",
        index: 0,
        name: "weather"
      },
      type: "tool-call.delta"
    });
    expect(events[3]).toMatchObject({
      toolCall: {
        argumentsDelta: 'Ranchi"}',
        index: 0
      },
      type: "tool-call.delta"
    });
    expect(events[4]).toMatchObject({
      response: {
        finishReason: "tool_calls",
        id: "chatcmpl_stream",
        message: {
          content: "Checking ",
          toolCalls: [
            {
              arguments: '{"city":"Ranchi"}',
              id: "call_1",
              name: "weather"
            }
          ]
        },
        usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 }
      },
      type: "response.completed"
    });
  });

  it("honors an already-aborted signal before invoking the transport", async () => {
    let calls = 0;
    const provider = new OpenAIProvider({
      apiKey: "test-openai-key",
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      }
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.chat(
        {
          messages: [{ content: "Hello", role: "user" }],
          model: "gpt-test"
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({
      provider: "OpenAI",
      retryable: false
    });
    expect(calls).toBe(0);
  });

  it("surfaces provider SSE error events as retryable ProviderErrors", async () => {
    const fetch: FetchImplementation = async () =>
      sseResponse([
        {
          error: {
            code: 429,
            message: "Rate limited for sk-secret-value"
          }
        }
      ]);
    const provider = new OpenAIProvider({ apiKey: "test-openai-key", fetch });

    const consume = async (): Promise<void> => {
      const events: ProviderStreamEvent[] = [];
      for await (const event of provider.stream({
        messages: [{ content: "Hello", role: "user" }],
        model: "gpt-test"
      })) {
        events.push(event);
      }
    };

    await expect(consume()).rejects.toMatchObject({
      provider: "OpenAI",
      retryable: true,
      status: 429
    });
  });

  it("returns a retryable ProviderError without exposing an API key", async () => {
    const fetch: FetchImplementation = async () =>
      new Response(JSON.stringify({ error: { message: "rate limited for sk-secret-value" } }), {
        status: 429,
        statusText: "Too Many Requests"
      });
    const provider = new OpenAIProvider({ apiKey: "test-openai-key", fetch });

    await expect(
      provider.chat({
        messages: [{ content: "Hello", role: "user" }],
        model: "gpt-test"
      })
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      provider: "OpenAI",
      retryable: true,
      status: 429
    });

    await provider
      .chat({
        messages: [{ content: "Hello", role: "user" }],
        model: "gpt-test"
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as Error).message).not.toContain("sk-secret-value");
      });
  });
});
