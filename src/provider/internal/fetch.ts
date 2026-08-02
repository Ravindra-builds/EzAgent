import { ProviderConfigurationError, ProviderError } from "../../errors";
import { isRecord, redactSensitiveText, truncate } from "../../utils";

/** A fetch-compatible transport that can be injected for tests or custom runtimes. */
export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface JsonPostRequest {
  readonly provider: string;
  readonly fetch: FetchImplementation;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly payload: unknown;
  readonly signal?: AbortSignal;
}

/** Resolves an injected transport or the runtime's native Fetch implementation. */
export function resolveFetch(fetchImplementation?: FetchImplementation): FetchImplementation {
  if (fetchImplementation !== undefined) {
    return fetchImplementation;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new ProviderConfigurationError(
      "No Fetch implementation is available. Use a runtime with Fetch support or provide config.fetch.",
      { metadata: { capability: "fetch" } }
    );
  }

  return globalThis.fetch.bind(globalThis) as FetchImplementation;
}

/** Joins a provider base URL and a relative endpoint without duplicating slashes. */
export function joinUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

/** Validates a provider endpoint before it is used for requests. */
export function requireBaseUrl(provider: string, baseUrl: string): string {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    throw new ProviderConfigurationError(`${provider} requires a non-empty base URL.`, {
      metadata: { provider }
    });
  }

  const normalizedBaseUrl = baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalizedBaseUrl);
  } catch (cause) {
    throw new ProviderConfigurationError(`${provider} received an invalid base URL.`, {
      cause,
      metadata: { provider }
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderConfigurationError(`${provider} base URL must use HTTP or HTTPS.`, {
      metadata: { provider, protocol: parsed.protocol }
    });
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new ProviderConfigurationError(`${provider} base URL must not contain credentials.`, {
      metadata: { provider }
    });
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new ProviderConfigurationError(
      `${provider} base URL must not contain a query or fragment.`,
      {
        metadata: { provider }
      }
    );
  }

  return normalizedBaseUrl.replace(/\/+$/, "");
}

/** Fails early when a provider is created without usable credentials. */
export function requireApiKey(provider: string, apiKey: string): string {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new ProviderConfigurationError(`${provider} requires a non-empty API key.`, {
      metadata: { provider }
    });
  }

  return apiKey;
}

/** Performs an authenticated JSON POST and safely decodes the JSON response. */
export async function postJson<T>(request: JsonPostRequest): Promise<T> {
  const response = await post(request, "application/json");

  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ProviderError(`${request.provider} returned an invalid JSON response.`, {
      cause,
      provider: request.provider,
      retryable: false
    });
  }
}

/** Performs a POST that is expected to return a Server-Sent Events response. */
export async function postSse(request: JsonPostRequest): Promise<Response> {
  return post(request, "text/event-stream");
}

async function post(request: JsonPostRequest, accept: string): Promise<Response> {
  if (request.signal?.aborted === true) {
    throw new ProviderError(`${request.provider} request was aborted.`, {
      provider: request.provider,
      retryable: false
    });
  }

  let body: string;

  try {
    body = JSON.stringify(request.payload);
  } catch (cause) {
    throw new ProviderError(`${request.provider} could not serialize the provider request.`, {
      cause,
      provider: request.provider,
      retryable: false
    });
  }

  const init: RequestInit = {
    body,
    headers: {
      ...request.headers,
      Accept: accept,
      "Content-Type": "application/json"
    },
    method: "POST"
  };

  if (request.signal !== undefined) {
    init.signal = request.signal;
  }

  let response: Response;
  try {
    response = await request.fetch(request.url, init);
  } catch (cause) {
    const wasAborted = request.signal?.aborted ?? false;
    throw new ProviderError(
      wasAborted
        ? `${request.provider} request was aborted.`
        : `${request.provider} request failed.`,
      {
        cause,
        provider: request.provider,
        retryable: !wasAborted
      }
    );
  }

  if (!response.ok) {
    const detail = await readProviderErrorDetail(response);
    const statusText = truncate(redactSensitiveText(response.statusText.trim()), 200);
    const statusDetail =
      statusText.length > 0 ? ` (${response.status} ${statusText})` : ` (${response.status})`;
    const suffix = detail.length > 0 ? `: ${detail}` : "";

    throw new ProviderError(`${request.provider} request failed${statusDetail}${suffix}`, {
      provider: request.provider,
      retryable: isRetryableStatus(response.status),
      status: response.status
    });
  }

  return response;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function readProviderErrorDetail(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return "";
  }

  if (body.length === 0) {
    return "";
  }

  let detail = body;
  try {
    const parsed: unknown = JSON.parse(body);
    detail = extractErrorMessage(parsed) ?? body;
  } catch {
    // Non-JSON error bodies are common for proxies and should remain useful.
  }

  return truncate(redactSensitiveText(detail.replace(/\s+/g, " ").trim()), 500);
}

function extractErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.message === "string") {
    return value.message;
  }

  if (isRecord(value.error) && typeof value.error.message === "string") {
    return value.error.message;
  }

  return undefined;
}
