import { z } from "zod";

import { Agent, OpenAIProvider, Runner, tool } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const weather = tool({
  description: "Returns the current weather for a city.",
  execute: async ({ city, unit }) => {
    // Replace this deterministic example with your weather API call.
    return {
      city,
      temperature: unit === "celsius" ? 27 : 81,
      unit
    };
  },
  name: "get_weather",
  schema: z.object({
    city: z.string().min(1).describe("City name"),
    unit: z.enum(["celsius", "fahrenheit"]).default("celsius")
  }),
  timeoutMs: 5_000
});

const agent = new Agent({
  instructions: "Use get_weather when the user asks for current weather.",
  model: "gpt-4.1-mini",
  name: "Weather Assistant",
  provider: new OpenAIProvider({ apiKey }),
  tools: [weather]
});

const runner = new Runner({ maxIterations: 6 });
runner.on("tool:start", ({ toolName }) => console.log(`Calling ${toolName}…`));
runner.on("tool:error", ({ error }) => console.error("Tool failed:", error.message));

const result = await runner.run(agent, {
  input: "What is the weather in Ranchi in celsius?"
});

console.log(result.output);
