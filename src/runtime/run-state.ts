import type { ChatMessage, MessageContent, ProviderUsage } from "../types";
import { freezeChatMessage } from "../utils";

/** Mutable state owned by exactly one Runner invocation. */
export class RunState {
  readonly runId: string;
  readonly agentName: string;
  readonly startedAt: number;

  private readonly history: ChatMessage[];
  private iterationCount = 0;
  private toolCallCount = 0;
  private handoffCount = 0;
  private aggregateUsage: MutableUsage = {
    cachedInputTokens: undefined,
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined
  };

  constructor(input: {
    readonly runId: string;
    readonly agentName: string;
    readonly instructions: string;
    readonly userInput: MessageContent;
    readonly startedAt: number;
    readonly initialMessages?: readonly ChatMessage[];
  }) {
    this.runId = input.runId;
    this.agentName = input.agentName;
    this.startedAt = input.startedAt;

    const restored = (input.initialMessages ?? []).map((message) => freezeChatMessage(message));
    if (restored.length === 0 || restored[0]?.role !== "system") {
      restored.unshift(freezeChatMessage({ content: input.instructions, role: "system" }));
    }
    restored.push(freezeChatMessage({ content: input.userInput, role: "user" }));
    this.history = restored;
  }

  get iterations(): number {
    return this.iterationCount;
  }

  get toolCalls(): number {
    return this.toolCallCount;
  }

  get handoffs(): number {
    return this.handoffCount;
  }

  /** Appends and returns a cloned, frozen message from this run's private transcript. */
  append<TMessage extends ChatMessage>(message: TMessage): TMessage {
    const frozen = freezeChatMessage(message) as TMessage;
    this.history.push(frozen);
    return frozen;
  }

  /** Increments and returns the number of provider turns made by this run. */
  nextIteration(): number {
    this.iterationCount += 1;
    return this.iterationCount;
  }

  /** Increments and returns the number of attempted tool calls in this run. */
  nextToolCall(): number {
    this.toolCallCount += 1;
    return this.toolCallCount;
  }

  /** Increments and returns the number of accepted handoffs in this run. */
  nextHandoff(): number {
    this.handoffCount += 1;
    return this.handoffCount;
  }

  /** Creates an immutable transcript snapshot, optionally adding ephemeral prompt messages. */
  messages(ephemeralMessages: readonly ChatMessage[] = []): readonly ChatMessage[] {
    if (ephemeralMessages.length === 0) {
      return Object.freeze([...this.history]);
    }

    const ephemeral = ephemeralMessages.map((message) => freezeChatMessage(message));
    const [first, ...remaining] = this.history;
    if (first?.role === "system") {
      return Object.freeze([first, ...ephemeral, ...remaining]);
    }

    return Object.freeze([...ephemeral, ...this.history]);
  }

  /** Adds normalized usage from one model response. */
  addUsage(usage: ProviderUsage | undefined): void {
    if (usage === undefined) {
      return;
    }

    this.aggregateUsage.inputTokens = addOptional(
      this.aggregateUsage.inputTokens,
      usage.inputTokens
    );
    this.aggregateUsage.outputTokens = addOptional(
      this.aggregateUsage.outputTokens,
      usage.outputTokens
    );
    this.aggregateUsage.totalTokens = addOptional(
      this.aggregateUsage.totalTokens,
      usage.totalTokens
    );
    this.aggregateUsage.cachedInputTokens = addOptional(
      this.aggregateUsage.cachedInputTokens,
      usage.cachedInputTokens
    );
  }

  /** Returns aggregate usage only when at least one provider reported it. */
  usage(): ProviderUsage | undefined {
    const { inputTokens, outputTokens, totalTokens, cachedInputTokens } = this.aggregateUsage;
    if (
      inputTokens === undefined &&
      outputTokens === undefined &&
      totalTokens === undefined &&
      cachedInputTokens === undefined
    ) {
      return undefined;
    }

    return Object.freeze({
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(cachedInputTokens === undefined ? {} : { cachedInputTokens })
    });
  }
}

interface MutableUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
  cachedInputTokens: number | undefined;
}

function addOptional(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) {
    return current;
  }

  return (current ?? 0) + next;
}
