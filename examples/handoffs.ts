import { Agent, handoff, OpenAIProvider, Runner } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const provider = new OpenAIProvider({ apiKey });
const billing = new Agent({
  instructions: "You are the billing specialist. Handle invoices and payment questions only.",
  model: "gpt-4.1-mini",
  name: "Billing",
  provider
});
const technical = new Agent({
  instructions: "You are the technical support specialist. Handle product troubleshooting only.",
  model: "gpt-4.1-mini",
  name: "Technical Support",
  provider
});
const router = new Agent({
  handoffs: [
    handoff(billing, { description: "Delegate billing, payment, refund, or invoice questions." }),
    handoff(technical, { description: "Delegate technical troubleshooting questions." })
  ],
  instructions:
    "Route specialist questions through a handoff. Answer simple general questions directly.",
  model: "gpt-4.1-mini",
  name: "Support Router",
  provider
});

const runner = new Runner({ maxHandoffs: 3 });
runner.on("handoff:start", ({ fromAgent, toAgent }) => {
  console.log(`Delegating from ${fromAgent} to ${toAgent}…`);
});

const result = await runner.run(router, {
  input: "My invoice has an unexpected charge."
});

console.log(result.output);
console.log(`Final agent: ${result.finalAgentName}`);
console.log(`Trace handoffs: ${result.trace.handoffs.length}`);
