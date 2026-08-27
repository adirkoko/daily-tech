export interface AiMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface AiCompletionRequest {
  readonly messages: readonly AiMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly responseFormat?: "text" | "json";
  readonly signal?: AbortSignal;
}

export interface AiCompletion {
  readonly content: string;
  readonly model: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
}

export interface AiCompletionClient {
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
}

export interface OpenAiCompatibleClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

export class AiProviderError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null, cause?: unknown) {
    super(message, { cause });
    this.name = "AiProviderError";
    this.status = status;
  }
}

export class InvalidAiResponseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "InvalidAiResponseError";
  }
}

export class OpenAiCompatibleClient implements AiCompletionClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAiCompatibleClientOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new TypeError("apiKey cannot be empty.");
    }
    if (options.model.trim().length === 0) {
      throw new TypeError("model cannot be empty.");
    }

    const baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "");
    const parsedUrl = new URL(baseUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new TypeError("baseUrl must use HTTP or HTTPS.");
    }
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer.");
    }

    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#baseUrl = baseUrl;
    this.#timeoutMs = timeoutMs;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    if (request.messages.length === 0) {
      throw new TypeError("At least one message is required.");
    }
    if (
      request.temperature !== undefined &&
      (!Number.isFinite(request.temperature) ||
        request.temperature < 0 ||
        request.temperature > 2)
    ) {
      throw new RangeError("temperature must be between 0 and 2.");
    }

    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort(request.signal?.reason);
    if (request.signal?.aborted === true) {
      onAbort();
    } else {
      request.signal?.addEventListener("abort", onAbort, { once: true });
    }
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
          ...this.#headers,
        },
        body: JSON.stringify({
          model: request.model ?? this.#model,
          messages: request.messages,
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          ...(request.responseFormat === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 500);
        throw new AiProviderError(
          `AI provider returned HTTP ${response.status}${responseBody ? `: ${responseBody}` : "."}`,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new InvalidAiResponseError(
          "AI provider returned a success response that was not valid JSON.",
          error,
        );
      }
      return parseCompletionPayload(payload);
    } catch (error) {
      if (error instanceof AiProviderError || error instanceof InvalidAiResponseError) {
        throw error;
      }
      const message = abortController.signal.aborted
        ? "AI provider request was aborted or timed out."
        : "AI provider request failed.";
      throw new AiProviderError(message, null, error);
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function parseJsonCompletion<T>(
  completion: AiCompletion,
  parse: (value: unknown) => T,
): T {
  try {
    return parse(JSON.parse(completion.content) as unknown);
  } catch (error) {
    throw new InvalidAiResponseError("AI response was not valid expected JSON.", error);
  }
}

function parseCompletionPayload(payload: unknown): AiCompletion {
  if (!isRecord(payload)) {
    throw new InvalidAiResponseError("AI response must be an object.");
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new InvalidAiResponseError("AI response did not contain a message choice.");
  }
  if (typeof choice.message.content !== "string") {
    throw new InvalidAiResponseError("AI response message content must be a string.");
  }

  const usage = isRecord(payload.usage) ? payload.usage : {};
  const inputTokens = nonNegativeNumber(usage.prompt_tokens);
  const outputTokens = nonNegativeNumber(usage.completion_tokens);
  const totalTokens = nonNegativeNumber(
    usage.total_tokens,
    inputTokens + outputTokens,
  );

  return {
    content: choice.message.content,
    model: typeof payload.model === "string" ? payload.model : "unknown",
    usage: { inputTokens, outputTokens, totalTokens },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
