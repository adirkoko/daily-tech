import { isCalendarDate, isUtcTimestamp } from "@daily-tech/core";

import {
  parseJsonResult,
  type AiWebResearchClient,
  type AiWebResearchResult,
} from "../ai/contracts.js";
import type { ModelUsage, StageResult } from "../types.js";
import { CitationIndex, canonicalizeUrl } from "./citation-validation.js";
import {
  EVENT_DATE_EVIDENCE_KINDS,
  RESEARCH_CATEGORIES,
  SOURCE_TYPES,
  type GapResearchBatch,
  type GapResearchRequest,
  type Importance,
  type NewsResearchProvider,
  type NewsResearchRequest,
  type RejectedResearchStory,
  type ResearchBatch,
  type ResearchCategory,
  type ResearchSource,
  type ResearchStoryInput,
  type SourceType,
  type EventDateEvidenceKind,
} from "./contracts.js";
import { WEB_GAP_RESEARCH_PROMPT, WEB_RESEARCH_PROMPT } from "./prompts.js";
import { GAP_RESPONSE_SCHEMA, RESEARCH_RESPONSE_SCHEMA } from "./schemas.js";

export class InvalidResearchResponseError extends Error {
  readonly rejectedStories: readonly RejectedResearchStory[];

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly rejectedStories?: readonly RejectedResearchStory[];
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "InvalidResearchResponseError";
    this.rejectedStories = options.rejectedStories ?? [];
  }
}

export interface ModelNewsResearchProviderOptions {
  readonly client: AiWebResearchClient;
}

export class ModelNewsResearchProvider implements NewsResearchProvider {
  readonly #client: AiWebResearchClient;

  constructor(options: ModelNewsResearchProviderOptions) {
    this.#client = options.client;
  }

  async research(request: NewsResearchRequest): Promise<StageResult<ResearchBatch>> {
    const result = await this.#client.execute({
      instructions: WEB_RESEARCH_PROMPT,
      input: {
        window: serializeWindow(request.context),
        scope: request.scope,
      },
      schemaName: "daily_tech_research",
      schema: RESEARCH_RESPONSE_SCHEMA,
    });
    return {
      value: parseBatch(result, "stories", request.scope.maximumStories),
      usage: usageFrom(result),
    };
  }

  async findGaps(request: GapResearchRequest): Promise<StageResult<GapResearchBatch>> {
    const result = await this.#client.execute({
      instructions: WEB_GAP_RESEARCH_PROMPT,
      input: {
        window: serializeWindow(request.context),
        minimumImportance: request.minimumImportance,
        maximumMissingStories: request.maximumMissingStories,
        existingStories: request.existingStories,
        draft: request.draft,
      },
      schemaName: "daily_tech_gap_research",
      schema: GAP_RESPONSE_SCHEMA,
    });
    const batch = parseBatch(result, "missingStories", request.maximumMissingStories);
    return {
      value: {
        missingStories: batch.stories,
        rejectedStories: batch.rejectedStories,
      },
      usage: usageFrom(result),
    };
  }
}

function parseBatch(
  result: AiWebResearchResult,
  property: "stories" | "missingStories",
  maximumStories: number,
): ResearchBatch {
  if (!Number.isInteger(maximumStories) || maximumStories < 0) {
    throw new RangeError("maximumStories must be a non-negative integer.");
  }
  const citations = new CitationIndex(result.citations);
  return parseJsonResult(result.content, (value): ResearchBatch => {
    const root = asRecord(value, "research response");
    const rawStories = root[property];
    if (!Array.isArray(rawStories)) {
      throw new InvalidResearchResponseError(`${property} must be an array.`);
    }
    if (rawStories.length > maximumStories) {
      throw new InvalidResearchResponseError(
        `${property} exceeds the configured maximum of ${maximumStories}.`,
      );
    }
    const stories: ResearchStoryInput[] = [];
    const rejectedStories: RejectedResearchStory[] = [];
    rawStories.forEach((rawStory, index) => {
      try {
        stories.push(parseStory(rawStory, `${property}[${index}]`, citations));
      } catch (error) {
        rejectedStories.push({
          index,
          title: extractTitle(rawStory),
          reason: errorMessage(error),
        });
      }
    });
    if (rawStories.length > 0 && stories.length === 0) {
      throw new InvalidResearchResponseError(
        formatAllRejectedMessage(property, rejectedStories),
        { rejectedStories },
      );
    }
    return { stories, rejectedStories };
  });
}

function parseStory(
  value: unknown,
  path: string,
  citations: CitationIndex,
): ResearchStoryInput {
  const record = asRecord(value, path);
  const occurredOn = asString(record.occurredOn, `${path}.occurredOn`);
  if (!isCalendarDate(occurredOn)) {
    throw new TypeError(`${path}.occurredOn must use YYYY-MM-DD format.`);
  }
  const occurredAt = nullableTimestamp(record.occurredAt, `${path}.occurredAt`);
  const sources = asArray(record.sources, `${path}.sources`).map((source, index) =>
    parseSource(source, `${path}.sources[${index}]`, citations),
  );
  if (sources.length === 0) throw new TypeError(`${path}.sources cannot be empty.`);
  const sourceUrls = new Set(sources.map(({ url }) => canonicalizeUrl(url)));
  const evidenceRecord = asRecord(record.eventDateEvidence, `${path}.eventDateEvidence`);
  const evidenceSourceUrl = citations.require(
    asString(evidenceRecord.sourceUrl, `${path}.eventDateEvidence.sourceUrl`),
    `${path}.eventDateEvidence.sourceUrl`,
  );
  if (!sourceUrls.has(evidenceSourceUrl)) {
    throw new TypeError(
      `${path}.eventDateEvidence.sourceUrl must be a story source; value=${JSON.stringify(evidenceSourceUrl)}`,
    );
  }
  const evidenceDate = asString(
    evidenceRecord.eventDate,
    `${path}.eventDateEvidence.eventDate`,
  );
  if (!isCalendarDate(evidenceDate)) {
    throw new TypeError(`${path}.eventDateEvidence.eventDate must use YYYY-MM-DD format.`);
  }
  const evidenceKind = asEnum(
    evidenceRecord.kind,
    EVENT_DATE_EVIDENCE_KINDS,
    `${path}.eventDateEvidence.kind`,
  ) as EventDateEvidenceKind;
  return {
    title: asString(record.title, `${path}.title`),
    factualSummary: asString(record.factualSummary, `${path}.factualSummary`),
    whyItMatters: asString(record.whyItMatters, `${path}.whyItMatters`),
    keyFacts: asStringArray(record.keyFacts, `${path}.keyFacts`),
    availability: nullableString(record.availability, `${path}.availability`),
    category: asEnum(
      record.category,
      RESEARCH_CATEGORIES,
      `${path}.category`,
    ) as ResearchCategory,
    importance: asImportance(record.importance, `${path}.importance`),
    occurredOn,
    occurredAt,
    eventDateEvidence: {
      eventDate: evidenceDate,
      kind: evidenceKind,
      sourceUrl: evidenceSourceUrl,
      explanation: asString(
        evidenceRecord.explanation,
        `${path}.eventDateEvidence.explanation`,
      ),
    },
    companies: asStringArray(record.companies, `${path}.companies`),
    topics: asStringArray(record.topics, `${path}.topics`),
    sources,
  };
}

function parseSource(
  value: unknown,
  path: string,
  citations: CitationIndex,
): ResearchSource {
  const record = asRecord(value, path);
  const publishedOn = nullableCalendarDate(record.publishedOn, `${path}.publishedOn`);
  const publishedAt = nullableTimestamp(record.publishedAt, `${path}.publishedAt`);
  const timestampDate = publishedAt?.slice(0, 10) ?? null;
  if (publishedOn !== null && timestampDate !== null && publishedOn !== timestampDate) {
    throw new TypeError(
      `${path}.publishedOn must match the UTC calendar date in ${path}.publishedAt; `
      + `publishedOn=${JSON.stringify(publishedOn)}; publishedAt=${JSON.stringify(publishedAt)}`,
    );
  }
  return {
    url: citations.require(asString(record.url, `${path}.url`), `${path}.url`),
    title: asString(record.title, `${path}.title`),
    publisher: asString(record.publisher, `${path}.publisher`),
    publishedOn: publishedOn ?? timestampDate,
    publishedAt,
    type: asEnum(record.type, SOURCE_TYPES, `${path}.type`) as SourceType,
  };
}

function serializeWindow(context: NewsResearchRequest["context"]): Record<string, string> {
  return {
    date: context.window.date,
    timeZone: context.window.timeZone,
    start: context.window.start.toISOString(),
    endExclusive: context.window.endExclusive.toISOString(),
  };
}

function usageFrom(result: AiWebResearchResult): ModelUsage {
  return {
    ...result.usage,
    webSearchCalls: result.webSearchCalls,
  };
}

function extractTitle(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const title = (value as Record<string, unknown>).title;
  return typeof title === "string" ? title : null;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : asString(value, path);
}

function nullableTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  const timestamp = asString(value, path);
  if (!isUtcTimestamp(timestamp)) {
    throw new TypeError(
      `${path} must be an ISO UTC timestamp; value=${JSON.stringify(timestamp)}`,
    );
  }
  return timestamp;
}

function nullableCalendarDate(value: unknown, path: string): string | null {
  if (value === null) return null;
  const date = asString(value, path);
  if (!isCalendarDate(date)) {
    throw new TypeError(
      `${path} must be a calendar date in YYYY-MM-DD format; value=${JSON.stringify(date)}`,
    );
  }
  return date;
}

function asStringArray(value: unknown, path: string): readonly string[] {
  return asArray(value, path).map((item, index) => asString(item, `${path}[${index}]`));
}

function asEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
): string {
  const parsed = asString(value, path);
  if (!allowed.includes(parsed)) throw new TypeError(`${path} is invalid.`);
  return parsed;
}

function asImportance(value: unknown, path: string): Importance {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw new TypeError(`${path} must be an integer between 1 and 5.`);
  }
  return value as Importance;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown story validation failure.";
}

function formatAllRejectedMessage(
  property: "stories" | "missingStories",
  rejectedStories: readonly RejectedResearchStory[],
): string {
  const details = rejectedStories.map(({ index, title, reason }) =>
    `  - index=${index}; title=${title === null ? "<missing>" : JSON.stringify(title)}; reason=${reason}`
  );
  return [
    `Every story in ${property} failed source or schema validation:`,
    ...details,
  ].join("\n");
}
