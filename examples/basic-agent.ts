import { Agent, OpenAIProvider, Runner } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const agent = new Agent({
  instructions: "Answer clearly and concisely.",
  model: "gpt-4.1-mini",
  name: "Helpful Assistant",
  provider: new OpenAIProvider({ apiKey })
});

const runner = new Runner();
runner.on("model:end", ({ iteration, response }) => {
  console.log(`Model turn ${String(iteration)} finished with ${response.finishReason}.`);
});

const result = await runner.run(agent, {
  input: "Explain why provider abstractions are useful in one sentence."
});

console.log(result.output);
