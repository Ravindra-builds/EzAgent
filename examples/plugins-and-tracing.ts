import {
  Agent,
  InMemoryStorage,
  InMemoryTraceExporter,
  middleware,
  OpenAIProvider,
  plugin,
  Runner
} from "ezagent";

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

const loggingPlugin = plugin({
  middleware: [
    middleware({
      after: ({ result }) => {
        console.log("Completed with:", result);
      },
      before: ({ runId }) => {
        console.log(`Starting run ${runId}`);
      },
      name: "plugin_logger"
    })
  ],
  name: "logging_plugin"
});

const baseAgent = new Agent({
  instructions: "Answer concisely and accurately.",
  model: "gpt-4.1-mini",
  name: "Traced Assistant",
  provider: new OpenAIProvider({ apiKey })
});
const agent = baseAgent.use(loggingPlugin);
const exporter = new InMemoryTraceExporter();
const runner = new Runner({
  middleware: [
    middleware({
      before: ({ sessionId }) => {
        if (sessionId === undefined) {
          throw new Error("This application requires a session ID.");
        }
      },
      name: "session_required"
    })
  ],
  storage: new InMemoryStorage(),
  traceExporter: exporter
});

const result = await runner.run(agent, {
  input: "Explain provider retries in one sentence.",
  sessionId: "example_session"
});

console.log(result.output);
console.log(JSON.stringify(result.trace, null, 2));
console.log(exporter.get(result.runId)?.status);
