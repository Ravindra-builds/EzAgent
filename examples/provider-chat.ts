import { OpenAIProvider } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const provider = new OpenAIProvider({ apiKey });
const response = await provider.chat({
  model: "gpt-4.1-mini",
  messages: [
    {
      role: "user",
      content: "In one sentence, explain what a provider adapter does."
    }
  ]
});

console.log(response.message.content);
