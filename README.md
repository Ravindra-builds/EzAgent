<p align="center">
  <img src="./assets/ezagent-logo.png" width="340" alt="EzAgent logo" />
</p>

<p align="center">
  <strong>Build reliable AI agents with full control over the runtime.</strong>
</p>

<p align="center">
  <a href="#installation">Install</a> ·
  <a href="#30-second-quick-start">Quick Start</a> ·
  <a href="#examples">Examples</a> ·
  <a href="./docs/README.md">Documentation</a> ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

# EzAgent

EzAgent is a lightweight, provider-agnostic TypeScript SDK for building AI agents without delegating the runtime to another framework.

## Why EzAgent

- **Lightweight** — focused modules, small dependency surface, no hosted platform requirement.
- **Provider agnostic** — run the same Agent through OpenAI, Gemini, or your own `Provider` implementation.
- **Transparent runtime** — inspect transcripts, tools, retries, handoffs, traces, and final output.
- **Event driven** — subscribe to provider, token, tool, guardrail, handoff, middleware, retry, and completion events.
- **Type safe** — strict TypeScript, Zod-backed tools, typed structured output, immutable configuration, and typed runtime events.
- **Production-minded defaults** — bounded iterations, tool calls, handoffs, output repairs, deadlines, cancellation, and retry policies.

## Installation

Choose your package manager:

```bash
npm install ezagent zod
```

```bash
pnpm add ezagent zod
```

```bash
bun add ezagent zod
```

```bash
yarn add ezagent zod
```

EzAgent targets Node.js 18 or newer. Install `zod` directly when defining tools or structured-output schemas.

## 30 Second Quick Start

Create an `.env` file with `OPENAI_API_KEY`, then run this minimal agent:

```ts
import { Agent, OpenAIProvider, Runner } from "ezagent";

const agent = new Agent({
  name: "Assistant",
  instructions: "Answer clearly and concisely.",
  model: "gpt-4.1-mini",
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! })
});

const result = await new Runner().run(agent, {
  input: "Explain what an AI agent SDK does in one sentence."
});

console.log(result.output);
```

For a local project, see the complete runnable version in [`examples/basic-agent.ts`](examples/basic-agent.ts).

## Features

- Immutable `Agent` configuration
- Original bounded `Runner` runtime loop
- OpenAI and Gemini adapters plus custom `Provider` support
- Zod-validated tools with timeouts and cancellation
- Sessions with in-memory and atomic file storage
- Optional factual long-term memory
- Input, output, tool, and approval guardrails
- Typed structured output with repair retries
- Async-iterator streaming through `Runner.stream()`
- Multi-agent handoffs with loop prevention
- Provider retry policy with exponential backoff
- Immutable traces and trace exporters
- Lifecycle middleware and immutable Agent plugins
- Typed `EventBus` and comprehensive runtime events

## Architecture

```text
Developer
  │
  ▼
Agent (instructions, provider, tools, handoffs, safety, plugins)
  │
  ▼
Runner (sessions, memory, middleware, limits, retries, traces)
  │
  ├── Provider.chat() / Provider.stream()
  ├── ToolExecutor
  ├── Guardrails + structured-output repair
  └── EventBus / RunResult / RunTrace
```

EzAgent owns the orchestration loop. Providers own vendor protocol translation. Tools, storage, memory, tracing, middleware, and plugins are independent extension boundaries.

## Playground Setup

The playground automatically loads `.env` and works in local demo mode when keys are missing.

```bash
cp .env.example .env
npm install
npm run playground
```

Configure a real provider in `.env`:

```dotenv
EZAGENT_PROVIDER=openai
OPENAI_API_KEY=your_key_here
# Or set EZAGENT_PROVIDER=gemini and GEMINI_API_KEY=your_key_here
```

Useful commands:

- `/exit` — leave the playground
- `/reset` — clear the in-memory session
- `/trace` — print the most recent trace

Run `npm run playground -- --help` for a non-interactive setup check. Full details are in the [playground guide](docs/playground.md).

## Examples

All examples are type-checked by `npm run check:examples` and are included in the npm package.

| Scenario                        | Example                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| Basic chat                      | [`basic-agent.ts`](examples/basic-agent.ts)                   |
| Direct provider call            | [`provider-chat.ts`](examples/provider-chat.ts)               |
| Tools                           | [`weather-tool.ts`](examples/weather-tool.ts)                 |
| Sessions                        | [`sessions-memory.ts`](examples/sessions-memory.ts)           |
| Memory                          | [`sessions-memory.ts`](examples/sessions-memory.ts)           |
| Streaming                       | [`structured-streaming.ts`](examples/structured-streaming.ts) |
| Structured output               | [`structured-streaming.ts`](examples/structured-streaming.ts) |
| Guardrails                      | [`guardrails.ts`](examples/guardrails.ts)                     |
| Handoffs                        | [`handoffs.ts`](examples/handoffs.ts)                         |
| Provider fallback pattern       | [`provider-fallback.ts`](examples/provider-fallback.ts)       |
| Middleware, plugins, and traces | [`plugins-and-tracing.ts`](examples/plugins-and-tracing.ts)   |
| Interactive playground          | [`playground.ts`](examples/playground.ts)                     |

## Documentation

Documentation lives in [`docs/`](docs/README.md) and is included in the package.

- [Agents and runtime](docs/agents-and-runtime.md)
- [Providers](docs/providers.md)
- [Tools and events](docs/tools-and-events.md)
- [Sessions and memory](docs/sessions-and-memory.md)
- [Guardrails, output, and streaming](docs/guardrails-output-streaming.md)
- [Handoffs, tracing, middleware, and plugins](docs/handoffs-tracing-middleware-plugins.md)
- [API reference](docs/api-reference.md)
- [Playground](docs/playground.md)

## Development

```bash
npm install
npm run check
npm run build
npm run pack:check
```

`npm run check` runs formatting, linting, strict TypeScript, example validation, and Vitest. `npm run pack:check` validates the publishable tarball contents.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for project setup, test and build commands, commit conventions, module boundaries, provider/tool guidance, and example validation.

## License

EzAgent is released under the [MIT License](LICENSE).
