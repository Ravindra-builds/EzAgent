import type { RunTrace, TraceExporter } from "./types";

/** A deterministic trace exporter useful for tests, local diagnostics, and embedding. */
export class InMemoryTraceExporter implements TraceExporter {
  private readonly traces = new Map<string, RunTrace>();

  export(trace: RunTrace): void {
    this.traces.set(trace.runId, trace);
  }

  get(runId: string): RunTrace | undefined {
    return this.traces.get(runId);
  }

  list(): readonly RunTrace[] {
    return Object.freeze([...this.traces.values()]);
  }

  clear(): void {
    this.traces.clear();
  }
}
