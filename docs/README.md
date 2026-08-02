# EzAgent documentation

Start here when using EzAgent without reading implementation source.

## Getting started

1. Read the [README quick start](../README.md#30-second-quick-start).
2. Copy [`.env.example`](../.env.example) to `.env` for the playground.
3. Run `npm run playground` to verify local setup.
4. Follow an example from [`examples/`](../examples/).

## Guides

| Guide                                                                                | Covers                                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [Agents and runtime](agents-and-runtime.md)                                          | Agent configuration, Runner, limits, cancellation, results       |
| [Providers](providers.md)                                                            | OpenAI, Gemini, custom providers, cancellation, mocked transport |
| [Tools and events](tools-and-events.md)                                              | Zod tools, event bus, runtime lifecycle events                   |
| [Sessions and memory](sessions-and-memory.md)                                        | Sessions, storage adapters, factual memory retrieval             |
| [Guardrails, output, and streaming](guardrails-output-streaming.md)                  | Safety phases, typed output, repair retries, async iterators     |
| [Handoffs, tracing, middleware, and plugins](handoffs-tracing-middleware-plugins.md) | Delegation, retry policy, traces, extension hooks                |
| [API reference](api-reference.md)                                                    | Public exports and error codes                                   |
| [Playground](playground.md)                                                          | `.env` setup and interactive terminal use                        |
| [Milestones](milestones.md)                                                          | Project scope and implementation status                          |

## Development and release

- [Contributing](../CONTRIBUTING.md)
- [Changelog](../CHANGELOG.md)
- [MIT License](../LICENSE)

All documentation pages are shipped in the npm package under `docs/`.
