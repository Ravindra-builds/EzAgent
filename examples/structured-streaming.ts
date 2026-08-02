import { z } from "zod";

import { Agent, OpenAIProvider, Runner } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const agent = new Agent({
  instructions: "Return a concise, factual answer.",
  model: "gpt-4.1-mini",
  name: "Structured Streaming Agent",
  output: z.object({
    answer: z.string(),
    confidence: z.number().min(0).max(1)
  }),
  provider: new OpenAIProvider({ apiKey })
});

const runner = new Runner({ maxOutputRetries: 2 });
for await (const event of runner.stream(agent, {
  input: "What is Jharkhand's capital?"
})) {
  if (event.type === "token") {
    process.stdout.write(event.delta);
  }
  if (event.type === "retry") {
    console.log("\nRepairing structured output…");
  }
  if (event.type === "result") {
    console.log("\nValidated result:", event.result.output);
  }
}
