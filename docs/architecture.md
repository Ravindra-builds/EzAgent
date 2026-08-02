# EzAgent architecture (milestones 1–7)

EzAgent separates immutable configuration, its original runtime loop, persistence, factual memory, safety, protocol translation, tools, delegation, tracing, middleware, plugins, and observability:

```text
Developer
  │
  ├── Agent
  │     ├── tools
  │     ├── handoffs
  │     ├── guardrails
  │     ├── output schema
  │     └── plugins
  │
  └── Runner
        ├── middleware pipeline
        ├── RunState / Session + StorageAdapter
        ├── MemoryAdapter (ephemeral facts)
        ├── Provider retry policy
        ├── Provider.chat() / Provider.stream()
        ├── ToolExecutor
        ├── handoff switching
        ├── structured-output repair
        ├── TraceCollector / TraceExporter
        └── EventBus / AsyncIterator stream
```

## Ownership boundaries

| Module                  | Owns                                                                                    | Does not own                                     |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `agent/`                | Immutable configuration, tools/handoffs/plugins metadata                                | Execution and transcript mutation                |
| `runtime/`              | Bounded execution, retries, session hydration, handoff switching, streaming composition | Vendor protocol details                          |
| `provider/`             | Authentication, vendor mapping, HTTP/SSE parsing                                        | Orchestration, tools, sessions                   |
| `tools/`                | Zod argument validation, callback execution, deadlines, serialization                   | Provider calls and handoff routing               |
| `handoff/`              | Immutable model-visible delegation target definitions                                   | Recursive agent execution or hidden sub-runs     |
| `session/` / `storage/` | Conversation shape and persistence adapters                                             | Long-term factual retrieval                      |
| `memory/`               | Durable factual record contracts and retrieval adapters                                 | Conversation persistence or automatic extraction |
| `guardrails/`           | Named allow/block decisions                                                             | Provider protocols or tool execution             |
| `output/`               | Schema conversion, final output validation, repair prompts                              | Model invocation and retry scheduling            |
| `middleware/`           | Ordered lifecycle hooks                                                                 | Core model/tool/handoff behavior                 |
| `plugins/`              | Immutable Agent middleware contributions                                                | Mutation of core internals                       |
| `tracing/`              | Immutable terminal trace collection/export boundary                                     | Runtime control flow                             |
| `events/`               | Typed observational event delivery                                                      | Business logic or retries                        |

## Runtime invariants

- `Agent` is immutable and has no execution method; `Runner` executes all work.
- No external agent framework is called or wrapped.
- Sessions are transcript history; factual memory is ephemeral prompt context.
- Provider retries only replay non-streaming retryable provider failures.
- Handoffs append an explicit tool acknowledgment and target-agent system instruction, preserving transcript context.
- Visited agent names and `maxHandoffs` prevent delegation loops.
- Input/output guardrails fail a run; tool/approval blocks return safe tool errors to the model.
- Structured output is both a provider hint and a runtime Zod contract.
- Traces include prompts, responses, tools, retries, handoffs, guardrails, middleware, final output, and errors.
- Events, trace exporters, and error middleware cannot crash a successful core run through their own failures.

## Extension direction

New functionality should attach through provider implementations, adapters, middleware, plugins, trace exporters, and public contracts. This keeps EzAgent transparent and maintainable while preserving a single original runtime loop.
