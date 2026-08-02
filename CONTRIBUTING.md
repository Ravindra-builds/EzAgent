# Contributing to EzAgent

Thank you for contributing to EzAgent. The project intentionally implements its own agent runtime and does not wrap another agent framework.

## Project Setup

Requirements:

- Node.js 18 or newer
- npm 10 or newer recommended

```bash
git clone https://github.com/Ravindra-builds/ezagent
cd ezagent
npm install
cp .env.example .env
```

`.env` is only needed for real-provider examples or the playground. The test suite never makes real API calls.

## Development Workflow

| Command                  | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `npm run typecheck`      | Strict TypeScript verification                           |
| `npm run check:examples` | Type-check every example                                 |
| `npm test`               | Run the Vitest suite                                     |
| `npm run test:watch`     | Run the Vitest suite in watch mode                       |
| `npm run lint`           | Run ESLint                                               |
| `npm run lint:fix`       | Run ESLint and auto-fix issues                           |
| `npm run format`         | Run Prettier and format files                            |
| `npm run format:check`   | Run Prettier verification                                |
| `npm run check`          | Run all checks (format, lint, typecheck, examples, test) |
| `npm run build`          | Produce ESM, CJS, and declaration bundles                |
| `npm run pack:check`     | Run build plus npm pack --dry-run                        |
| `npm run playground`     | Run the interactive local playground                     |

## Build

Running `npm run build` uses `tsup` to produce ESM (`.js`), CommonJS (`.cjs`), and TypeScript declaration (`.d.ts`) bundles in the `dist/` directory.

## Test

The project uses Vitest for testing.

- Place deterministic unit tests near their domain under `tests/`.
- Tests are structured across `tests/runtime/`, `tests/integration/`, and `tests/mocks/`.
- Use `tests/mocks/MockProvider` for runtime tests; do not call real providers. The test suite never makes real API calls.
- Add integration coverage whenever a feature crosses Agent → Runner → Provider → Tool → Result boundaries.
- Test both success and graceful failure paths.
- Keep tests independent: no test should depend on execution order or shared environment state.

## Lint

The project uses ESLint and Prettier for code formatting and linting. Run `npm run lint` and `npm run format` before committing.

## Examples

Every example must:

1. use a documented public API;
2. handle missing API keys clearly;
3. avoid hidden external services beyond the configured provider;
4. be listed in the README examples table;
5. pass `npm run check:examples`.

Examples importing the package name are mapped to local source through `tsconfig.examples.json`, so they compile before publishing.

## Coding Standards

- Use double quotes for strings.
- Always use semicolons.
- Prefer `readonly` properties and `const` declarations.
- Prefer immutable objects and use `Object.freeze` where appropriate.
- Group imports consistently (e.g., Node.js built-ins, third-party libraries, internal modules).
- Do not use default exports; use named exports instead.

## Adding a provider

1. Implement the `Provider` interface with `chat()` and `stream()`.
2. Translate vendor requests/responses entirely inside `src/provider/`.
3. Normalize messages, tool calls, finish reasons, usage, and stream events.
4. Respect `AbortSignal` and surface failures as `ProviderError` with retryability metadata.
5. Add unit tests using injected `fetch` or a mock transport—never real API keys.
6. Export the adapter from `src/provider/index.ts`, the root API, `tsup.config.ts`, and `package.json` only when it is intended to be public.
7. Document configuration and limitations in `docs/providers.md`.

## Adding a tool

Use the public factory rather than manually constructing tool objects:

```ts
const example = tool({
  name: "example_tool",
  description: "Does one focused thing.",
  schema: z.object({ value: z.string() }),
  execute: async ({ value }, context) => {
    return { value, runId: context.runId };
  }
});
```

Tool schemas must describe object parameters. Preserve cancellation through `context.signal`, return JSON-serializable values, and add tests for valid input, invalid input, timeouts, and thrown exceptions when applicable.

## Commit Style

Use concise, imperative commit messages. Conventional Commit prefixes are recommended:

```text
feat: add a redis storage adapter
fix: preserve tool-call IDs in streaming
docs: clarify session metadata behavior
test: cover provider retry exhaustion
chore: update package metadata
```

Keep a commit focused. Do not mix broad formatting changes with behavior changes.

## Folder Structure

```text
src/
  agent/       immutable Agent configuration and plugins
  runtime/     bounded execution loop, streaming, retries, middleware
  provider/    vendor protocol adapters
  tools/       Zod validation and tool execution
  handoff/     delegation targets and loop-safe transitions
  session/     transcript model
  storage/     session persistence adapters
  memory/      factual memory contracts/adapters
  guardrails/  safety decisions
  output/      structured-output conversion and validation
  tracing/     immutable traces/exporters
  events/      typed event bus
  types/       provider-neutral shared types
```

Keep responsibilities one-way. Providers must not import Runner. Agent must not execute. Storage must not own memory. Trace exporters must not alter runtime success/failure behavior.

## Pull Requests

Before requesting review, ensure you have completed the following checklist:

- [ ] Run `npm run check` (runs format, lint, tests, etc.)
- [ ] Run `npm run build`
- [ ] Run `npm run pack:check`
- [ ] Describe the problem, behavior change, tests, docs updates, and any intentional limitations in the pull request body.
