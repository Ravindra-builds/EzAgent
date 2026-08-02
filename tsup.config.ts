import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: {
    resolve: false
  },
  entry: {
    index: "src/index.ts",
    "agent/index": "src/agent/index.ts",
    "events/index": "src/events/index.ts",
    "guardrails/index": "src/guardrails/index.ts",
    "handoff/index": "src/handoff/index.ts",
    "memory/index": "src/memory/index.ts",
    "middleware/index": "src/middleware/index.ts",
    "output/index": "src/output/index.ts",
    "plugins/index": "src/plugins/index.ts",
    "provider/index": "src/provider/index.ts",
    "runtime/index": "src/runtime/index.ts",
    "session/index": "src/session/index.ts",
    "storage/index": "src/storage/index.ts",
    "tools/index": "src/tools/index.ts",
    "tracing/index": "src/tracing/index.ts",
    "types/index": "src/types/index.ts",
    "errors/index": "src/errors/index.ts"
  },
  format: ["esm", "cjs"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "es2022",
  treeshake: true
});
