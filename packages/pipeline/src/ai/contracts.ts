export interface AiMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface AiJsonSchemaResponseFormat {
  readonly type: "json_schema";
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface AiCompletionRequest {
  readonly messages: readonly AiMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly responseFormat?: "text" | AiJsonSchemaResponseFormat;
  readonly signal?: AbortSignal;
}

export interface AiCompletion {
  readonly content: string;
  readonly model: string;
}

export interface AiCompletionClient {
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
}

export interface ProviderCitation {
  readonly url: string;
  readonly title: string | null;
}

export interface AiWebResearchRequest {
  readonly instructions: string;
  readonly input: unknown;
  readonly schemaName: string;
  readonly schema: Readonly<Record<string, unknown>>;
  /** Overrides the client's default tool-call budget for this one call, e.g. a
   *  deep-research call investigating several candidates needs more than a
   *  single-topic discovery call does. */
  readonly maxToolCalls?: number;
  readonly signal?: AbortSignal;
}

export interface AiWebResearchResult {
  readonly content: string;
  readonly citations: readonly ProviderCitation[];
  readonly model: string;
}

export interface AiWebResearchClient {
  execute(request: AiWebResearchRequest): Promise<AiWebResearchResult>;
}

export class AiProviderError extends Error {
  readonly status: number | null;
  /** The provider's own suggested wait, parsed from a `Retry-After` response
   *  header when present (429/503). Only meaningful together with `status`. */
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number | null, cause?: unknown, retryAfterMs: number | null = null) {
    super(message, { cause });
    this.name = "AiProviderError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class InvalidAiResponseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "InvalidAiResponseError";
  }
}

export function parseJsonResult<T>(
  content: string,
  parse: (value: unknown) => T,
): T {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch (error) {
    throw new InvalidAiResponseError("AI response content was not valid JSON.", error);
  }
  return parse(value);
}
