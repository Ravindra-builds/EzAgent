# CLI playground

The repository includes an interactive terminal playground for debugging agents manually. It automatically loads `.env` through `dotenv` and falls back to a local demo provider when keys are absent.

```bash
cp .env.example .env
npm run playground
```

Use Gemini instead:

```bash
EZAGENT_PROVIDER=gemini GEMINI_API_KEY=... npm run playground
```

Optional variables:

| Variable             | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `EZAGENT_PROVIDER`   | `openai` (default) or `gemini`              |
| `EZAGENT_MODEL`      | Override the default provider model         |
| `EZAGENT_SESSION_ID` | Reuse a process-local playground session ID |

Playground commands:

| Command            | Effect                                 |
| ------------------ | -------------------------------------- |
| `/exit` or `/quit` | Exit the terminal chat                 |
| `/reset`           | Clear the in-memory session transcript |
| `/trace`           | Print the latest finalized `RunTrace`  |

If `EZAGENT_PROVIDER` is `openai` or `gemini` but its matching key is missing, startup prints exact `.env` setup instructions and starts local demo mode instead of failing. The playground uses `Runner.stream()` so tokens appear as they arrive. It is intentionally a debugging tool, not a hosted UI or production shell.
