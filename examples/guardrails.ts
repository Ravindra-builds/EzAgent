import { allow, Agent, block, OpenAIProvider, Runner } from "ezagent";
import type { InputGuardrail, OutputGuardrail } from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const denySecrets: InputGuardrail = {
  check: ({ input }) =>
    typeof input === "string" && input.toLocaleLowerCase().includes("api key")
      ? block("Do not send secrets to the model.")
      : allow,
  name: "deny_secrets"
};

const denySensitiveOutput: OutputGuardrail = {
  check: ({ text }) =>
    text.toLocaleLowerCase().includes("password") ? block("Sensitive output was blocked.") : allow,
  name: "deny_sensitive_output"
};

const agent = new Agent({
  guardrails: {
    input: [denySecrets],
    output: [denySensitiveOutput]
  },
  instructions: "Provide helpful, safe answers.",
  model: "gpt-4.1-mini",
  name: "Safe Assistant",
  provider: new OpenAIProvider({ apiKey })
});

const runner = new Runner();
runner.on("guardrail", ({ guardrail, phase, reason }) => {
  console.warn(`${phase} guardrail ${guardrail} blocked work: ${reason}`);
});

const result = await runner.run(agent, {
  input: "Explain how to rotate an application credential safely."
});

console.log(result.output);
