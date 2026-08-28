import type { ModelUsage } from "../types.js";

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
  readonly usage: ModelUsage;
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
  readonly signal?: AbortSignal;
}

export interface AiWebResearchResult {
  readonly content: string;
  readonly citations: readonly ProviderCitation[];
  readonly model: string;
  readonly usage: ModelUsage;
  readonly webSearchCalls: number;
}

export interface AiWebResearchClient {
  execute(request: AiWebResearchRequest): Promise<AiWebResearchResult>;
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

export function parseJsonResult<T>(
  content: string,
  parse: (value: unknown) => T,
): T {
  try {
    return parse(JSON.parse(content) as unknown);
  } catch (error) {
    if (error instanceof InvalidAiResponseError) throw error;
    throw new InvalidAiResponseError("AI response was not valid expected JSON.", error);
  }
}
