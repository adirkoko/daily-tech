import { isCalendarDate } from "@daily-tech/core";

import {
  parseJsonResult,
  type AiWebResearchClient,
  type AiWebResearchResult,
} from "../ai/contracts.js";
import { CitationIndex, canonicalizeUrl } from "./citation-validation.js";
import {
  EVENT_DATE_EVIDENCE_KINDS,
  RESEARCH_CATEGORIES,
  SOURCE_TYPES,
  type CandidateStoryInput,
  type DeepResearchBatch,
  type DeepResearchedStoryInput,
  type DeepResearchRequest,
  type DiscoveryBatch,
  type EventDateEvidenceKind,
  type FocusedDiscoveryRequest,
  type Importance,
  type LightDiscoveryRequest,
  type NewsResearchProvider,
  type RejectedResearchStory,
  type ResearchCategory,
  type ResearchSource,
  type SourceType,
} from "./contracts.js";
import {
  WEB_DEEP_RESEARCH_PROMPT,
  WEB_FOCUSED_DISCOVERY_PROMPT,
  WEB_LIGHT_DISCOVERY_PROMPT,
} from "./prompts.js";
import {
  DISCOVERY_RESPONSE_SCHEMA,
  FOCUSED_DISCOVERY_RESPONSE_SCHEMA,
  buildDeepResearchResponseSchema,
} from "./schemas.js";

/** Deep research investigates several candidates with several searches each, in one
 *  call — it needs a materially higher tool-call budget than a discovery pass. */
const DEEP_RESEARCH_MAX_TOOL_CALLS = 60;

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

  async discover(request: LightDiscoveryRequest): Promise<DiscoveryBatch> {
    const result = await this.#client.execute({
      instructions: WEB_LIGHT_DISCOVERY_PROMPT,
      input: {
        window: serializeWindow(request.context),
        scope: request.scope,
      },
      schemaName: "daily_tech_light_discovery",
      schema: DISCOVERY_RESPONSE_SCHEMA,
    });
    return parseDiscoveryBatch(result, "stories", request.scope.maximumCandidatesPerCall);
  }

  async findGaps(request: FocusedDiscoveryRequest): Promise<DiscoveryBatch> {
    const result = await this.#client.execute({
      instructions: WEB_FOCUSED_DISCOVERY_PROMPT,
      input: {
        window: serializeWindow(request.context),
        minimumImportance: request.minimumImportance,
        maximumMissingStories: request.maximumCandidatesPerCall,
        existingStories: request.existingStories,
        focusKeywords: request.focusKeywords ?? [],
      },
      schemaName: "daily_tech_focused_discovery",
      schema: FOCUSED_DISCOVERY_RESPONSE_SCHEMA,
    });
    return parseDiscoveryBatch(result, "missingStories", request.maximumCandidatesPerCall);
  }

  async deepResearch(request: DeepResearchRequest): Promise<DeepResearchBatch> {
    const result = await this.#client.execute({
      instructions: WEB_DEEP_RESEARCH_PROMPT,
      input: {
        window: serializeWindow(request.context),
        maximumStories: request.maximumStories,
        editorialInstructions: request.editorialInstructions,
        candidates: request.candidates,
      },
      schemaName: "daily_tech_deep_research",
      schema: buildDeepResearchResponseSchema(request.maximumStories),
      maxToolCalls: DEEP_RESEARCH_MAX_TOOL_CALLS,
    });
    return parseDeepResearchBatch(result, request.maximumStories);
  }
}

function parseDiscoveryBatch(
  result: AiWebResearchResult,
  property: "stories" | "missingStories",
  maximumStories: number,
): DiscoveryBatch {
  if (!Number.isInteger(maximumStories) || maximumStories < 0) {
    throw new RangeError("maximumStories must be a non-negative integer.");
  }
  const citations = new CitationIndex(result.citations);
  return parseJsonResult(result.content, (value): DiscoveryBatch => {
    const root = asRecord(value, "discovery response");
    const rawStories = root[property];
    if (!Array.isArray(rawStories)) {
      throw new InvalidResearchResponseError(`${property} must be an array.`);
    }
    if (rawStories.length > maximumStories) {
      throw new InvalidResearchResponseError(
        `${property} exceeds the configured maximum of ${maximumStories}.`,
      );
    }
    const stories: CandidateStoryInput[] = [];
    const rejectedStories: RejectedResearchStory[] = [];
    rawStories.forEach((rawStory, index) => {
      try {
        stories.push(parseCandidateStory(rawStory, `${property}[${index}]`, citations));
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

function parseCandidateStory(
  value: unknown,
  path: string,
  citations: CitationIndex,
): CandidateStoryInput {
  const record = asRecord(value, path);
  const occurredOn = asString(record.occurredOn, `${path}.occurredOn`);
  if (!isCalendarDate(occurredOn)) {
    throw new TypeError(`${path}.occurredOn must use YYYY-MM-DD format.`);
  }
  const sources = asArray(record.sources, `${path}.sources`).map((source, index) =>
    parseSource(source, `${path}.sources[${index}]`, citations),
  );
  if (sources.length === 0) throw new TypeError(`${path}.sources cannot be empty.`);
  const eventDateEvidence = parseEventDateEvidence(
    record.eventDateEvidence,
    `${path}.eventDateEvidence`,
    sources,
    citations,
  );
  return {
    title: asString(record.title, `${path}.title`),
    shortSummary: asString(record.shortSummary, `${path}.shortSummary`),
    category: asEnum(record.category, RESEARCH_CATEGORIES, `${path}.category`) as ResearchCategory,
    importance: asImportance(record.importance, `${path}.importance`),
    occurredOn,
    eventDateEvidence,
    companies: asStringArray(record.companies, `${path}.companies`),
    topics: asStringArray(record.topics, `${path}.topics`),
    sources,
  };
}

function parseDeepResearchBatch(
  result: AiWebResearchResult,
  maximumStories: number,
): DeepResearchBatch {
  const citations = new CitationIndex(result.citations);
  return parseJsonResult(result.content, (value): DeepResearchBatch => {
    const root = asRecord(value, "deep research response");
    const rawStories = root.stories;
    if (!Array.isArray(rawStories)) {
      throw new InvalidResearchResponseError("stories must be an array.");
    }
    if (rawStories.length > maximumStories) {
      throw new InvalidResearchResponseError(
        `stories exceeds the configured maximum of ${maximumStories}.`,
      );
    }
    const stories: DeepResearchedStoryInput[] = [];
    const rejectedStories: RejectedResearchStory[] = [];
    rawStories.forEach((rawStory, index) => {
      try {
        stories.push(parseDeepStory(rawStory, `stories[${index}]`, citations));
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
        formatAllRejectedMessage("stories", rejectedStories),
        { rejectedStories },
      );
    }
    return { stories };
  });
}

function parseDeepStory(
  value: unknown,
  path: string,
  citations: CitationIndex,
): DeepResearchedStoryInput {
  const record = asRecord(value, path);
  const occurredOn = asString(record.occurredOn, `${path}.occurredOn`);
  if (!isCalendarDate(occurredOn)) {
    throw new TypeError(`${path}.occurredOn must use YYYY-MM-DD format.`);
  }
  const sources = asArray(record.sources, `${path}.sources`).map((source, index) =>
    parseSource(source, `${path}.sources[${index}]`, citations),
  );
  if (sources.length === 0) throw new TypeError(`${path}.sources cannot be empty.`);
  const eventDateEvidence = parseEventDateEvidence(
    record.eventDateEvidence,
    `${path}.eventDateEvidence`,
    sources,
    citations,
  );
  return {
    candidateId: asString(record.candidateId, `${path}.candidateId`),
    title: asString(record.title, `${path}.title`),
    whatHappened: asString(record.whatHappened, `${path}.whatHappened`),
    whatChangedFromBefore: nullableString(record.whatChangedFromBefore, `${path}.whatChangedFromBefore`),
    technicalDetails: nullableString(record.technicalDetails, `${path}.technicalDetails`),
    capabilities: nullableString(record.capabilities, `${path}.capabilities`),
    pricing: nullableString(record.pricing, `${path}.pricing`),
    availability: nullableString(record.availability, `${path}.availability`),
    rollout: nullableString(record.rollout, `${path}.rollout`),
    supportedUsersOrPlatforms: nullableString(
      record.supportedUsersOrPlatforms,
      `${path}.supportedUsersOrPlatforms`,
    ),
    limitations: nullableString(record.limitations, `${path}.limitations`),
    whoIsAffected: nullableString(record.whoIsAffected, `${path}.whoIsAffected`),
    whyItMatters: asString(record.whyItMatters, `${path}.whyItMatters`),
    whatToDoWithItNow: nullableString(record.whatToDoWithItNow, `${path}.whatToDoWithItNow`),
    category: asEnum(record.category, RESEARCH_CATEGORIES, `${path}.category`) as ResearchCategory,
    importance: asImportance(record.importance, `${path}.importance`),
    occurredOn,
    eventDateEvidence,
    companies: asStringArray(record.companies, `${path}.companies`),
    topics: asStringArray(record.topics, `${path}.topics`),
    sources,
  };
}

function parseEventDateEvidence(
  value: unknown,
  path: string,
  sources: readonly ResearchSource[],
  citations: CitationIndex,
): DeepResearchedStoryInput["eventDateEvidence"] {
  const record = asRecord(value, path);
  const sourceUrls = new Set(sources.map(({ url }) => canonicalizeUrl(url)));
  const evidenceSourceUrl = citations.require(
    asString(record.sourceUrl, `${path}.sourceUrl`),
    `${path}.sourceUrl`,
  );
  if (!sourceUrls.has(evidenceSourceUrl)) {
    throw new TypeError(
      `${path}.sourceUrl must be a story source; value=${JSON.stringify(evidenceSourceUrl)}`,
    );
  }
  const evidenceDate = asString(record.eventDate, `${path}.eventDate`);
  if (!isCalendarDate(evidenceDate)) {
    throw new TypeError(`${path}.eventDate must use YYYY-MM-DD format.`);
  }
  return {
    eventDate: evidenceDate,
    kind: asEnum(record.kind, EVENT_DATE_EVIDENCE_KINDS, `${path}.kind`) as EventDateEvidenceKind,
    sourceUrl: evidenceSourceUrl,
    explanation: asString(record.explanation, `${path}.explanation`),
  };
}

function parseSource(
  value: unknown,
  path: string,
  citations: CitationIndex,
): ResearchSource {
  const record = asRecord(value, path);
  return {
    url: citations.require(asString(record.url, `${path}.url`), `${path}.url`),
    title: asString(record.title, `${path}.title`),
    publisher: asString(record.publisher, `${path}.publisher`),
    publishedOn: nullableCalendarDate(record.publishedOn, `${path}.publishedOn`),
    type: asEnum(record.type, SOURCE_TYPES, `${path}.type`) as SourceType,
  };
}

function serializeWindow(context: LightDiscoveryRequest["context"]): Record<string, string> {
  return {
    date: context.window.date,
    timeZone: context.window.timeZone,
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
