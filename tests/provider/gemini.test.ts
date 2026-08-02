import { describe, expect, it } from "vitest";

import { GeminiProvider } from "../../src/provider";
import type { FetchImplementation, ProviderChatRequest, ProviderStreamEvent } from "../../src";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

function sseResponse(payloads: readonly unknown[]): Response {
  return new Response(payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
    status: 200
  });
}

describe("GeminiProvider", () => {
  it("maps system instructions, function history, tools, and a function-call response", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetch: FetchImplementation = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    args: { city: "Ranchi" },
                    name: "weather"
                  }
                }
              ],
              role: "model"
            },
            finishReason: "STOP"
          }
        ],
        modelVersion: "gemini-2.0-flash",
        responseId: "gemini_response_123",
        usageMetadata: {
          candidatesTokenCount: 5,
          promptTokenCount: 11,
          totalTokenCount: 16
        }
      });
    };
    const provider = new GeminiProvider({ apiKey: "test-gemini-key", fetch });
    const request = {
      messages: [
        { content: "Be concise.", role: "system" },
        { content: "What is the Ranchi weather?", role: "user" },
        {
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
        {
          content: '{"temperatureC":27}',
          name: "weather",
          role: "tool",
          toolCallId: "call_weather"
        }
      ],
      model: "gemini-2.0-flash",
      responseFormat: {
        name: "weather_answer",
        schema: {
          properties: { summary: { type: "string" } },
          type: "object"
        },
        type: "json_schema"
      },
      toolChoice: "required",
      tools: [
        {
          name: "weather",
          parameters: {
            properties: { city: { type: "string" } },
            type: "object"
          }
        }
      ]
    } satisfies ProviderChatRequest;

    const result = await provider.chat(request);

    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    );
    expect(capturedInit?.headers).toMatchObject({ "x-goog-api-key": "test-gemini-key" });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      contents: [
        {
          parts: [{ text: "What is the Ranchi weather?" }],
          role: "user"
        },
        {
          parts: [
            {
              text: ""
            },
            {
              functionCall: {
                args: { city: "Ranchi" },
                name: "weather"
              }
            }
          ],
          role: "model"
        },
        {
          parts: [
            {
              functionResponse: {
                name: "weather",
                response: { temperatureC: 27 }
              }
            }
          ],
          role: "user"
        }
      ],
      generationConfig: {
        responseJsonSchema: {
          properties: { summary: { type: "string" } },
          type: "object"
        },
        responseMimeType: "application/json"
      },
      systemInstruction: {
        parts: [{ text: "Be concise." }]
      },
      toolConfig: {
        functionCallingConfig: { mode: "ANY" }
      },
      tools: [
        {
          functionDeclarations: [{ name: "weather" }]
        }
      ]
    });
    expect(result).toEqual({
      finishReason: "tool_calls",
      id: "gemini_response_123",
      message: {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: '{"city":"Ranchi"}',
            id: "gemini-call-0",
            name: "weather"
          }
        ]
      },
      model: "gemini-2.0-flash",
      provider: "gemini",
      usage: {
        inputTokens: 11,
        outputTokens: 5,
        totalTokens: 16
      }
    });
  });

  it("normalizes Gemini SSE chunks into provider stream events", async () => {
    const fetch: FetchImplementation = async () =>
      sseResponse([
        {
          candidates: [
            {
              content: { parts: [{ text: "Hello" }], role: "model" }
            }
          ],
          modelVersion: "gemini-2.0-flash",
          responseId: "gemini_stream_123"
        },
        {
          candidates: [
            {
              content: { parts: [{ text: " Ranchi" }], role: "model" },
              finishReason: "STOP"
            }
          ],
          modelVersion: "gemini-2.0-flash",
          responseId: "gemini_stream_123",
          usageMetadata: {
            candidatesTokenCount: 3,
            promptTokenCount: 4,
            totalTokenCount: 7
          }
        }
      ]);
    const provider = new GeminiProvider({ apiKey: "test-gemini-key", fetch });
    const events: ProviderStreamEvent[] = [];

    for await (const event of provider.stream({
      messages: [{ content: "Say hello", role: "user" }],
      model: "gemini-2.0-flash"
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        model: "gemini-2.0-flash",
        provider: "gemini",
        type: "response.start"
      },
      {
        delta: "Hello",
        provider: "gemini",
        type: "text.delta"
      },
      {
        delta: " Ranchi",
        provider: "gemini",
        type: "text.delta"
      },
      {
        provider: "gemini",
        response: {
          finishReason: "stop",
          id: "gemini_stream_123",
          message: { content: "Hello Ranchi", role: "assistant" },
          model: "gemini-2.0-flash",
          provider: "gemini",
          usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }
        },
        type: "response.completed"
      }
    ]);
  });

  it("does not claim image input support", async () => {
    const provider = new GeminiProvider({
      apiKey: "test-gemini-key",
      fetch: async () => jsonResponse({})
    });

    await expect(
      provider.chat({
        messages: [
          {
            content: [{ imageUrl: "https://example.test/image.png", type: "image_url" }],
            role: "user"
          }
        ],
        model: "gemini-2.0-flash"
      })
    ).rejects.toThrow("do not support image_url");
  });
});
