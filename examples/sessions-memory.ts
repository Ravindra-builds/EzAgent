import { Agent, InMemoryMemory, InMemoryStorage, OpenAIProvider, Runner } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const memory = new InMemoryMemory();
await memory.save({
  content: "Customer prefers concise Hindi replies.",
  namespace: "customer_123"
});

const agent = new Agent({
  instructions: "Be helpful and apply relevant customer preferences.",
  memory: {
    adapter: memory,
    namespace: "customer_123"
  },
  model: "gpt-4.1-mini",
  name: "Persistent Support Agent",
  provider: new OpenAIProvider({ apiKey })
});

const runner = new Runner({ storage: new InMemoryStorage() });
await runner.run(agent, {
  input: "Please remember that I need help with my account.",
  sessionId: "customer_123"
});

const result = await runner.run(agent, {
  input: "How should you reply to me?",
  sessionId: "customer_123"
});

console.log(result.output);
