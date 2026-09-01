import {
  AiProviderError,
  InvalidAiResponseError,
  type AiWebResearchClient,
  type AiWebResearchRequest,
  type AiWebResearchResult,
  type ProviderCitation,
} from "./contracts.js";
import { withAiRetry, type AiRetryOptions } from "./retry.js";

export interface OpenAiResponsesWebResearchClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxToolCalls?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
  /** Retry behavior for a transient failure (429/5xx, or a malformed-but-200
   *  envelope such as a missing web-search call or missing citations) — see
   *  ./retry.js. Defaults apply when omitted. */
  readonly retry?: AiRetryOptions;
}

export class OpenAiResponsesWebResearchClient implements AiWebResearchClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxToolCalls: number;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof globalThis.fetch;
  readonly #retry: Omit<AiRetryOptions, "signal">;

  constructor(options: OpenAiResponsesWebResearchClientOptions) {
    if (options.apiKey.trim().length === 0) throw new TypeError("apiKey cannot be empty.");
    if (options.model.trim().length === 0) throw new TypeError("model cannot be empty.");
    this.#baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "");
    const parsed = new URL(this.#baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new TypeError("baseUrl must use HTTP or HTTPS.");
    }
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#maxToolCalls = options.maxToolCalls ?? 20;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer.");
    }
    if (!Number.isInteger(this.#maxToolCalls) || this.#maxToolCalls < 1) {
      throw new RangeError("maxToolCalls must be a positive integer.");
    }
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#retry = options.retry ?? {};
  }

  async execute(request: AiWebResearchRequest): Promise<AiWebResearchResult> {
    if (request.instructions.trim().length === 0) {
      throw new TypeError("instructions cannot be empty.");
    }
    if (request.schemaName.trim().length === 0) {
      throw new TypeError("schemaName cannot be empty.");
    }
    const maxToolCalls = request.maxToolCalls ?? this.#maxToolCalls;
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1) {
      throw new RangeError("maxToolCalls must be a positive integer.");
    }

    return withAiRetry(
      () => this.#performRequest(request, maxToolCalls),
      { ...this.#retry, ...(request.signal === undefined ? {} : { signal: request.signal }) },
    );
  }

  async #performRequest(
    request: AiWebResearchRequest,
    maxToolCalls: number,
  ): Promise<AiWebResearchResult> {
    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort(request.signal?.reason);
    if (request.signal?.aborted === true) onAbort();
    else request.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => abortController.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
          ...this.#headers,
        },
        body: JSON.stringify({
          model: this.#model,
          instructions: request.instructions,
          input: JSON.stringify(request.input),
          tools: [{ type: "web_search" }],
          tool_choice: "required",
          max_tool_calls: maxToolCalls,
          include: ["web_search_call.action.sources"],
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
          store: false,
        }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        throw new AiProviderError(
          `AI web-research provider returned HTTP ${response.status}${body ? `: ${body}` : "."}`,
          response.status,
          undefined,
          parseRetryAfterMs(response),
        );
      }
      const payload = await readJsonResponse(response);
      return parseResponsesPayload(payload);
    } catch (error) {
      if (error instanceof AiProviderError || error instanceof InvalidAiResponseError) throw error;
      throw new AiProviderError(
        abortController.signal.aborted
          ? "AI web-research request was aborted or timed out."
          : "AI web-research request failed.",
        null,
        error,
      );
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const untilMs = Date.parse(header);
  return Number.isNaN(untilMs) ? null : Math.max(0, untilMs - Date.now());
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new InvalidAiResponseError(
      "AI web-research provider returned invalid JSON.",
      error,
    );
  }
}

export function parseResponsesPayload(payload: unknown): AiWebResearchResult {
  const root = asRecord(payload, "Responses API payload");
  if (root.status !== undefined && root.status !== "completed") {
    throw new InvalidAiResponseError("AI web-research response did not complete.");
  }
  if (!Array.isArray(root.output)) {
    throw new InvalidAiResponseError("AI web-research response.output must be an array.");
  }

  let content: string | null = null;
  let webSearchCalls = 0;
  const citations = new Map<string, ProviderCitation>();
  for (const itemValue of root.output) {
    const item = asRecord(itemValue, "response.output item");
    if (item.type === "web_search_call") {
      webSearchCalls += 1;
      collectActionSources(item.action, citations);
      continue;
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const partValue of item.content) {
      const part = asRecord(partValue, "response message content");
      if (part.type !== "output_text" || typeof part.text !== "string") continue;
      content = content === null ? part.text : `${content}\n${part.text}`;
      collectAnnotations(part.annotations, citations);
    }
  }

  if (webSearchCalls === 0) {
    throw new InvalidAiResponseError("AI provider returned no web-search call.");
  }
  if (content === null || content.trim().length === 0) {
    throw new InvalidAiResponseError("AI web-research response contained no output text.");
  }
  if (citations.size === 0) {
    throw new InvalidAiResponseError("AI web-research response contained no machine-readable citations.");
  }

  return {
    content,
    citations: [...citations.values()],
    model: typeof root.model === "string" ? root.model : "unknown",
  };
}

function collectAnnotations(
  value: unknown,
  citations: Map<string, ProviderCitation>,
): void {
  if (!Array.isArray(value)) return;
  for (const annotationValue of value) {
    if (!isRecord(annotationValue) || annotationValue.type !== "url_citation") continue;
    addCitation(annotationValue.url, annotationValue.title, citations);
  }
}

function collectActionSources(
  value: unknown,
  citations: Map<string, ProviderCitation>,
): void {
  if (!isRecord(value) || !Array.isArray(value.sources)) return;
  for (const source of value.sources) {
    if (!isRecord(source)) continue;
    addCitation(source.url, source.title, citations);
  }
}

function addCitation(
  urlValue: unknown,
  titleValue: unknown,
  citations: Map<string, ProviderCitation>,
): void {
  if (typeof urlValue !== "string" || !isHttpUrl(urlValue)) return;
  citations.set(urlValue, {
    url: urlValue,
    title: typeof titleValue === "string" && titleValue.trim().length > 0
      ? titleValue
      : null,
  });
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidAiResponseError(`${path} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
