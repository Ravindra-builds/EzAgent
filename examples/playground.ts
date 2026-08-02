import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { argv, stdin as input, stdout as output } from "node:process";

import { Agent, GeminiProvider, InMemoryStorage, OpenAIProvider, Runner } from "../src";
import type {
  Provider,
  ProviderCallOptions,
  ProviderCapabilities,
  ProviderChatRequest,
  ProviderResponse,
  ProviderStreamEvent
} from "../src";

class DemoProvider implements Provider {
  readonly id = "playground-demo";
  readonly capabilities: ProviderCapabilities = {
    imageInput: false,
    streaming: true,
    structuredOutput: false,
    tools: false
  };

  async chat(
    request: ProviderChatRequest,
    _options?: ProviderCallOptions
  ): Promise<ProviderResponse> {
    return this.responseFor(request);
  }

  async *stream(
    request: ProviderChatRequest,
    _options?: ProviderCallOptions
  ): AsyncGenerator<ProviderStreamEvent> {
    const response = await this.responseFor(request);
    const text = typeof response.message.content === "string" ? response.message.content : "";
    yield {
      model: response.model,
      provider: this.id,
      type: "response.start"
    };
    for (const token of text.split(/(\s+)/).filter((part) => part.length > 0)) {
      yield { delta: token, provider: this.id, type: "text.delta" };
    }
    yield { provider: this.id, response, type: "response.completed" };
  }

  private async responseFor(request: ProviderChatRequest): Promise<ProviderResponse> {
    const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
    const inputText =
      lastUser === undefined
        ? "Hello"
        : typeof lastUser.content === "string"
          ? lastUser.content
          : "your message";

    return {
      finishReason: "stop",
      message: {
        content: `Demo mode is active. I received: ${inputText}. Configure an API key in .env to use a real model.`,
        role: "assistant"
      },
      model: "ezagent-demo",
      provider: this.id
    };
  }
}

if (argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const requestedProvider = (process.env.EZAGENT_PROVIDER ?? "openai").toLocaleLowerCase();
const selection = resolveProvider(requestedProvider);
const storage = new InMemoryStorage();
const runner = new Runner({ storage });
const sessionId = process.env.EZAGENT_SESSION_ID ?? "playground";
const agent = new Agent({
  instructions:
    "You are EzAgent Playground, a concise and helpful assistant. State uncertainty instead of inventing facts.",
  model: process.env.EZAGENT_MODEL ?? defaultModel(selection.kind),
  name: "Playground Assistant",
  provider: selection.provider
});

printStartup(selection, sessionId);

if (!input.isTTY) {
  console.log(
    "Non-interactive terminal detected. Playground setup passed; run this command in a terminal to chat."
  );
  process.exit(0);
}

const readline = createInterface({ input, output });
try {
  while (true) {
    let prompt: string;
    try {
      prompt = (await readline.question("you> ")).trim();
    } catch {
      break;
    }

    if (prompt.length === 0) {
      continue;
    }
    if (prompt === "/exit" || prompt === "/quit") {
      break;
    }
    if (prompt === "/reset") {
      await storage.deleteSession(sessionId);
      console.log("Session cleared.\n");
      continue;
    }
    if (prompt === "/trace") {
      const trace = runner.listTraces().at(-1);
      console.log(
        trace === undefined
          ? "No completed run trace yet.\n"
          : `${JSON.stringify(trace, null, 2)}\n`
      );
      continue;
    }

    output.write("agent> ");
    let finalText = "";
    try {
      for await (const event of runner.stream(agent, {
        input: prompt,
        sessionId
      })) {
        if (event.type === "token") {
          output.write(event.delta);
        }
        if (event.type === "result") {
          finalText = event.result.text;
        }
      }
      if (finalText.length === 0) {
        console.log("(No text response returned.)");
      } else {
        console.log();
      }
    } catch (error) {
      console.error(`\nFriendly error: ${friendlyError(error)}`);
      console.error(
        "Use /trace for diagnostics. Check .env and provider settings if the issue persists.\n"
      );
    }
  }
} finally {
  readline.close();
}

interface ProviderSelection {
  readonly kind: "demo" | "gemini" | "openai";
  readonly provider: Provider;
  readonly setupMessage?: string;
}

function resolveProvider(kind: string): ProviderSelection {
  if (kind === "gemini") {
    const apiKey = readApiKey("GEMINI_API_KEY");
    if (apiKey !== undefined) {
      return { kind: "gemini", provider: new GeminiProvider({ apiKey }) };
    }
    return {
      kind: "demo",
      provider: new DemoProvider(),
      setupMessage: "GEMINI_API_KEY is missing; using local demo mode."
    };
  }

  if (kind === "openai") {
    const apiKey = readApiKey("OPENAI_API_KEY");
    if (apiKey !== undefined) {
      return { kind: "openai", provider: new OpenAIProvider({ apiKey }) };
    }
    return {
      kind: "demo",
      provider: new DemoProvider(),
      setupMessage: "OPENAI_API_KEY is missing; using local demo mode."
    };
  }

  return {
    kind: "demo",
    provider: new DemoProvider(),
    setupMessage: `EZAGENT_PROVIDER=${JSON.stringify(kind)} is unsupported; using local demo mode.`
  };
}

function readApiKey(name: "GEMINI_API_KEY" | "OPENAI_API_KEY"): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function printStartup(selection: ProviderSelection, currentSessionId: string): void {
  console.log("\n┌──────────────────────────────┐");
  console.log("│     EzAgent Playground       │");
  console.log("└──────────────────────────────┘");
  console.log(`  Provider : ${selection.kind}`);
  console.log(`  Model    : ${process.env.EZAGENT_MODEL ?? defaultModel(selection.kind)}`);
  console.log(`  Session  : ${currentSessionId}`);
  console.log(`  Commands : /exit  /reset  /trace`);
  if (selection.setupMessage !== undefined) {
    console.log(`\n⚠  ${selection.setupMessage}`);
    console.log("\nTo connect a real provider:");
    console.log("  1. cp .env.example .env");
    console.log("  2. Add your API key:");
    console.log("       OPENAI_API_KEY=sk-...    (for OpenAI)");
    console.log("       GEMINI_API_KEY=AQ....    (for Gemini)");
    console.log("  3. Set the provider:");
    console.log("       EZAGENT_PROVIDER=openai  (or gemini)");
    console.log("  4. Restart: npm run playground");
    console.log("\n  See .env.example for all available options.");
  } else {
    console.log("\n  ✓ Loaded provider configuration from .env");
  }
  console.log();
}

function printHelp(): void {
  console.log("Usage: npm run playground\n");
  console.log("Interactive CLI for EzAgent. Automatically loads .env via dotenv.\n");
  console.log("Setup:");
  console.log("  1. cp .env.example .env");
  console.log("  2. Set OPENAI_API_KEY or GEMINI_API_KEY in .env");
  console.log("  3. Set EZAGENT_PROVIDER=openai or EZAGENT_PROVIDER=gemini\n");
  console.log("Environment variables:");
  console.log("  EZAGENT_PROVIDER     Provider to use: openai | gemini  (default: openai)");
  console.log("  EZAGENT_MODEL        Override default model name");
  console.log("  EZAGENT_SESSION_ID   Session ID for conversation persistence\n");
  console.log("Without a valid API key, the playground runs in local demo mode.");
}

function defaultModel(kind: ProviderSelection["kind"]): string {
  if (kind === "gemini") {
    return "gemini-2.0-flash";
  }
  return kind === "openai" ? "gpt-4.1-mini" : "ezagent-demo";
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
