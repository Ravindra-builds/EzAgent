import { ProviderError } from "../../errors";
import { getFiniteNumber, getString, isRecord, redactSensitiveText, truncate } from "../../utils";

/** A decoded Server-Sent Event. */
export interface ServerSentEvent {
  readonly data: string;
  readonly event?: string;
  readonly id?: string;
}

/**
 * Decodes a UTF-8 Server-Sent Events response without buffering the full stream.
 * The reader is cancelled if a consumer stops iteration early.
 */
export async function* parseServerSentEvents(
  response: Response,
  provider: string,
  signal?: AbortSignal
): AsyncGenerator<ServerSentEvent> {
  if (response.body === null) {
    throw new ProviderError(`${provider} returned an empty streaming response body.`, {
      provider,
      retryable: true
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let eventId: string | undefined;
  let completed = false;

  const flushEvent = (): ServerSentEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined;
      eventId = undefined;
      return undefined;
    }

    const event: ServerSentEvent = {
      data: dataLines.join("\n"),
      ...(eventName === undefined ? {} : { event: eventName }),
      ...(eventId === undefined ? {} : { id: eventId })
    };
    dataLines = [];
    eventName = undefined;
    eventId = undefined;
    return event;
  };

  const consumeLine = (line: string): ServerSentEvent | undefined => {
    if (line.length === 0) {
      return flushEvent();
    }

    if (line.startsWith(":")) {
      return undefined;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    switch (field) {
      case "data":
        dataLines.push(value);
        break;
      case "event":
        eventName = value;
        break;
      case "id":
        eventId = value;
        break;
      default:
        break;
    }

    return undefined;
  };

  try {
    while (true) {
      throwIfAborted(provider, signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }

        const event = consumeLine(line);
        if (event !== undefined) {
          yield event;
        }

        newlineIndex = buffer.indexOf("\n");
      }
    }

    throwIfAborted(provider, signal);
    buffer += decoder.decode();
    if (buffer.length > 0) {
      const event = consumeLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      if (event !== undefined) {
        yield event;
      }
    }

    const event = flushEvent();
    if (event !== undefined) {
      yield event;
    }
    completed = true;
  } catch (cause) {
    if (signal?.aborted === true) {
      throw abortedStreamError(provider, cause);
    }
    if (cause instanceof ProviderError) {
      throw cause;
    }

    throw new ProviderError(`${provider} streaming response could not be read.`, {
      cause,
      provider,
      retryable: true
    });
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

/** Parses one JSON SSE payload and reports malformed provider data consistently. */
export function parseSseJson(event: ServerSentEvent, provider: string): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data) as unknown;
  } catch (cause) {
    throw new ProviderError(`${provider} sent malformed JSON in a streaming response.`, {
      cause,
      provider,
      retryable: false
    });
  }

  if (isRecord(payload) && payload.error !== undefined) {
    const error = payload.error;
    const errorRecord = isRecord(error) ? error : undefined;
    const status = errorRecord === undefined ? undefined : getFiniteNumber(errorRecord, "code");
    const detail = extractErrorDetail(error);
    const suffix = detail === undefined ? "" : `: ${detail}`;

    throw new ProviderError(`${provider} streaming request failed${suffix}`, {
      provider,
      ...(status === undefined ? {} : { status }),
      retryable: status === undefined ? false : isRetryableStatus(status)
    });
  }

  return payload;
}

function throwIfAborted(provider: string, signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortedStreamError(provider);
  }
}

function abortedStreamError(provider: string, cause?: unknown): ProviderError {
  return new ProviderError(`${provider} streaming request was aborted.`, {
    ...(cause === undefined ? {} : { cause }),
    provider,
    retryable: false
  });
}

function extractErrorDetail(value: unknown): string | undefined {
  if (typeof value === "string") {
    return truncate(redactSensitiveText(value), 500);
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const message = getString(value, "message");
  return message === undefined ? undefined : truncate(redactSensitiveText(message), 500);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
