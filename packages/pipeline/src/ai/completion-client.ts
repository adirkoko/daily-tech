import {
  AiProviderError,
  InvalidAiResponseError,
  type AiCompletion,
  type AiCompletionClient,
  type AiCompletionRequest,
} from "./contracts.js";

export interface OpenAiCompatibleCompletionClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAiCompatibleCompletionClient implements AiCompletionClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: OpenAiCompatibleCompletionClientOptions) {
    if (options.apiKey.trim().length === 0) throw new TypeError("apiKey cannot be empty.");
    if (options.model.trim().length === 0) throw new TypeError("model cannot be empty.");
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
    if (request.messages.length === 0) throw new TypeError("At least one message is required.");
    if (
      request.temperature !== undefined &&
      (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)
    ) {
      throw new RangeError("temperature must be between 0 and 2.");
    }

    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort(request.signal?.reason);
    if (request.signal?.aborted === true) onAbort();
    else request.signal?.addEventListener("abort", onAbort, { once: true });
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
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.responseFormat === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new AiProviderError(
          `AI provider returned HTTP ${response.status}${body ? `: ${body}` : "."}`,
          response.status,
        );
      }
      const payload = await readJsonResponse(response);
      return parseCompletionPayload(payload);
    } catch (error) {
      if (error instanceof AiProviderError || error instanceof InvalidAiResponseError) throw error;
      throw new AiProviderError(
        abortController.signal.aborted
          ? "AI provider request was aborted or timed out."
          : "AI provider request failed.",
        null,
        error,
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new InvalidAiResponseError(
      "AI provider returned a success response that was not valid JSON.",
      error,
    );
  }
}

function parseCompletionPayload(payload: unknown): AiCompletion {
  const root = asRecord(payload, "AI response");
  const choice = Array.isArray(root.choices) ? root.choices[0] : undefined;
  const choiceRecord = asRecord(choice, "AI response choice");
  const message = asRecord(choiceRecord.message, "AI response message");
  if (typeof message.content !== "string") {
    throw new InvalidAiResponseError("AI response message content must be a string.");
  }
  const usage = isRecord(root.usage) ? root.usage : {};
  const inputTokens = nonNegativeNumber(usage.prompt_tokens);
  const outputTokens = nonNegativeNumber(usage.completion_tokens);
  return {
    content: message.content,
    model: typeof root.model === "string" ? root.model : "unknown",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: nonNegativeNumber(usage.total_tokens, inputTokens + outputTokens),
    },
  };
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidAiResponseError(`${path} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
