import { isDayIntensity, isUtcTimestamp } from "@daily-tech/core";

import {
  parseJsonCompletion,
  type AiCompletion,
  type AiCompletionClient,
} from "./ai-client.js";
import {
  FILTER_SYSTEM_PROMPT,
  MISSING_NEWS_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  REVISION_SYSTEM_PROMPT,
  WRITER_SYSTEM_PROMPT,
} from "./prompts.js";
import {
  SOURCE_TYPES,
  type BriefDraft,
  type BriefWriter,
  type EditorialReview,
  type EditorialReviewer,
  type GeneratedDayMetadata,
  type MissingNewsChecker,
  type MissingNewsReview,
  type ModelUsage,
  type NewsFilter,
  type NewsResearcher,
  type PipelineContext,
  type ResearchCandidate,
  type ResearchSource,
  type RevisionRequest,
  type SourceType,
  type StageResult,
} from "./types.js";

export interface NewsSearchRequest {
  readonly query: string;
  readonly date: string;
  readonly start: Date;
  readonly endExclusive: Date;
  readonly limit: number;
}

export interface SearchHit {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  readonly publisher: string;
  readonly publishedAt: string | null;
}

export interface NewsSearchProvider {
  search(request: NewsSearchRequest): Promise<readonly SearchHit[]>;
}

export interface SearchBackedAgentOptions {
  readonly client: AiCompletionClient;
  readonly search: NewsSearchProvider;
  readonly queries?: readonly string[];
  readonly resultsPerQuery?: number;
}

const DEFAULT_RESEARCH_QUERIES = [
  "major AI model and product launches",
  "developer tools and cloud platform releases",
  "semiconductor hardware robotics computing announcements",
  "major open source software releases",
  "consumer technology product launches",
] as const;

const DEFAULT_MISSING_NEWS_QUERIES = [
  "technology announcements official newsroom release notes",
  "important AI hardware software launch yesterday",
  "GitHub major release developer tool announcement",
] as const;

export class SearchBackedNewsResearcher implements NewsResearcher {
  readonly #client: AiCompletionClient;
  readonly #search: NewsSearchProvider;
  readonly #queries: readonly string[];
  readonly #resultsPerQuery: number;

  constructor(options: SearchBackedAgentOptions) {
    this.#client = options.client;
    this.#search = options.search;
    this.#queries = validateQueries(options.queries ?? DEFAULT_RESEARCH_QUERIES);
    this.#resultsPerQuery = validateResultsPerQuery(options.resultsPerQuery ?? 10);
  }

  async collect(
    context: PipelineContext,
  ): Promise<StageResult<readonly ResearchCandidate[]>> {
    const hits = await collectSearchHits(
      this.#search,
      this.#queries,
      this.#resultsPerQuery,
      context,
    );
    if (hits.length === 0) {
      return { value: [] };
    }

    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            window: serializeWindow(context),
            searchResults: hits,
          }),
        },
      ],
      responseFormat: "json",
      temperature: 0,
    });
    const allowedUrls = new Set(hits.map(({ url }) => url));
    const candidates = parseCandidatesResponse(completion, allowedUrls).filter(
      (candidate) => isInsideWindow(candidate.occurredAt, context),
    );
    return stageResult(candidates, completion);
  }
}

export class PromptedNewsFilter implements NewsFilter {
  readonly #client: AiCompletionClient;

  constructor(client: AiCompletionClient) {
    this.#client = client;
  }

  async select(
    context: PipelineContext,
    candidates: readonly ResearchCandidate[],
  ): Promise<StageResult<readonly ResearchCandidate[]>> {
    if (candidates.length === 0) {
      return { value: [] };
    }
    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: FILTER_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            window: serializeWindow(context),
            candidates,
          }),
        },
      ],
      responseFormat: "json",
      temperature: 0,
    });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const selected = parseJsonCompletion(completion, (value) => {
      const record = asRecord(value, "filter response");
      return asStringArray(record.selected_ids, "selected_ids").map((id) => {
        const candidate = byId.get(id);
        if (candidate === undefined) {
          throw new TypeError(`Filter returned unknown candidate ID: ${id}.`);
        }
        return candidate;
      });
    });
    return stageResult(deduplicateById(selected), completion);
  }
}

export class PromptedBriefWriter implements BriefWriter {
  readonly #client: AiCompletionClient;

  constructor(client: AiCompletionClient) {
    this.#client = client;
  }

  async write(
    context: PipelineContext,
    developments: readonly ResearchCandidate[],
  ): Promise<StageResult<BriefDraft>> {
    return this.completeDraft(WRITER_SYSTEM_PROMPT, {
      window: serializeWindow(context),
      developments,
      quietDay: developments.length === 0,
    });
  }

  async revise(request: RevisionRequest): Promise<StageResult<BriefDraft>> {
    return this.completeDraft(REVISION_SYSTEM_PROMPT, {
      window: serializeWindow(request.context),
      developments: request.developments,
      currentDraft: request.draft,
      editorialFeedback: request.editorialFeedback,
      missingNews: request.missingNews,
    });
  }

  private async completeDraft(
    systemPrompt: string,
    payload: unknown,
  ): Promise<StageResult<BriefDraft>> {
    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
      responseFormat: "json",
      temperature: 0.2,
    });
    return stageResult(parseBriefDraft(completion), completion);
  }
}

export class PromptedEditorialReviewer implements EditorialReviewer {
  readonly #client: AiCompletionClient;

  constructor(client: AiCompletionClient) {
    this.#client = client;
  }

  async review(
    context: PipelineContext,
    developments: readonly ResearchCandidate[],
    draft: BriefDraft,
  ): Promise<StageResult<EditorialReview>> {
    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: REVIEW_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            window: serializeWindow(context),
            developments,
            draft,
          }),
        },
      ],
      responseFormat: "json",
      temperature: 0,
    });
    const review = parseJsonCompletion(completion, (value): EditorialReview => {
      const record = asRecord(value, "editorial review");
      if (typeof record.approved !== "boolean") {
        throw new TypeError("approved must be a boolean.");
      }
      return {
        approved: record.approved,
        feedback: asStringArray(record.feedback, "feedback"),
      };
    });
    return stageResult(review, completion);
  }
}

export class SearchBackedMissingNewsChecker implements MissingNewsChecker {
  readonly #client: AiCompletionClient;
  readonly #search: NewsSearchProvider;
  readonly #queries: readonly string[];
  readonly #resultsPerQuery: number;

  constructor(options: SearchBackedAgentOptions) {
    this.#client = options.client;
    this.#search = options.search;
    this.#queries = validateQueries(options.queries ?? DEFAULT_MISSING_NEWS_QUERIES);
    this.#resultsPerQuery = validateResultsPerQuery(options.resultsPerQuery ?? 10);
  }

  async check(
    context: PipelineContext,
    draft: BriefDraft,
  ): Promise<StageResult<MissingNewsReview>> {
    const hits = await collectSearchHits(
      this.#search,
      this.#queries,
      this.#resultsPerQuery,
      context,
    );
    if (hits.length === 0) {
      return { value: { missing: [], notes: [] } };
    }
    const completion = await this.#client.complete({
      messages: [
        { role: "system", content: MISSING_NEWS_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            window: serializeWindow(context),
            draft,
            searchResults: hits,
          }),
        },
      ],
      responseFormat: "json",
      temperature: 0,
    });
    const allowedUrls = new Set(hits.map(({ url }) => url));
    const review = parseJsonCompletion(completion, (value): MissingNewsReview => {
      const record = asRecord(value, "missing-news review");
      const missingValue = { candidates: record.missing };
      return {
        missing: parseCandidatesValue(missingValue, allowedUrls).filter((candidate) =>
          isInsideWindow(candidate.occurredAt, context),
        ),
        notes: asStringArray(record.notes, "notes"),
      };
    });
    return stageResult(review, completion);
  }
}

async function collectSearchHits(
  search: NewsSearchProvider,
  queries: readonly string[],
  resultsPerQuery: number,
  context: PipelineContext,
): Promise<readonly SearchHit[]> {
  const resultSets = await Promise.all(
    queries.map((query) =>
      search.search({
        query,
        date: context.window.date,
        start: context.window.start,
        endExclusive: context.window.endExclusive,
        limit: resultsPerQuery,
      }),
    ),
  );
  const byUrl = new Map<string, SearchHit>();
  for (const hit of resultSets.flat()) {
    validateSearchHit(hit);
    byUrl.set(hit.url, hit);
  }
  return [...byUrl.values()];
}

function parseCandidatesResponse(
  completion: AiCompletion,
  allowedUrls: ReadonlySet<string>,
): readonly ResearchCandidate[] {
  return parseJsonCompletion(completion, (value) =>
    parseCandidatesValue(value, allowedUrls),
  );
}

function parseCandidatesValue(
  value: unknown,
  allowedUrls: ReadonlySet<string>,
): readonly ResearchCandidate[] {
  const record = asRecord(value, "candidate response");
  if (!Array.isArray(record.candidates)) {
    throw new TypeError("candidates must be an array.");
  }
  return deduplicateById(
    record.candidates.map((candidate, index) =>
      parseCandidate(candidate, `candidates[${index}]`, allowedUrls),
    ),
  );
}

function parseCandidate(
  value: unknown,
  path: string,
  allowedUrls: ReadonlySet<string>,
): ResearchCandidate {
  const record = asRecord(value, path);
  const occurredAt = asString(record.occurredAt, `${path}.occurredAt`);
  if (!isUtcTimestamp(occurredAt)) {
    throw new TypeError(`${path}.occurredAt must be an ISO UTC timestamp.`);
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    throw new TypeError(`${path}.sources must be a non-empty array.`);
  }
  return {
    id: asString(record.id, `${path}.id`),
    headline: asString(record.headline, `${path}.headline`),
    summary: asString(record.summary, `${path}.summary`),
    occurredAt,
    companies: asStringArray(record.companies, `${path}.companies`),
    topics: asStringArray(record.topics, `${path}.topics`),
    sources: record.sources.map((source, index) =>
      parseSource(source, `${path}.sources[${index}]`, allowedUrls),
    ),
  };
}

function parseSource(
  value: unknown,
  path: string,
  allowedUrls: ReadonlySet<string>,
): ResearchSource {
  const record = asRecord(value, path);
  const url = asHttpUrl(record.url, `${path}.url`);
  if (!allowedUrls.has(url)) {
    throw new TypeError(`${path}.url was not present in the supplied search results.`);
  }
  const type = asString(record.type, `${path}.type`);
  if (!(SOURCE_TYPES as readonly string[]).includes(type)) {
    throw new TypeError(`${path}.type is invalid.`);
  }
  const publishedAt = record.publishedAt;
  if (
    publishedAt !== null &&
    (typeof publishedAt !== "string" || !isUtcTimestamp(publishedAt))
  ) {
    throw new TypeError(`${path}.publishedAt must be an ISO UTC timestamp or null.`);
  }
  return {
    url,
    title: asString(record.title, `${path}.title`),
    publisher: asString(record.publisher, `${path}.publisher`),
    publishedAt,
    type: type as SourceType,
  };
}

function parseBriefDraft(completion: AiCompletion): BriefDraft {
  return parseJsonCompletion(completion, (value): BriefDraft => {
    const record = asRecord(value, "brief response");
    const metadata = asRecord(record.metadata, "metadata");
    const significantItems = asNonNegativeInteger(
      metadata.significant_items,
      "metadata.significant_items",
    );
    const worthWatchingItems = asNonNegativeInteger(
      metadata.worth_watching_items,
      "metadata.worth_watching_items",
    );
    if (!isDayIntensity(metadata.day_intensity)) {
      throw new TypeError("metadata.day_intensity is invalid.");
    }
    const parsedMetadata: GeneratedDayMetadata = {
      summary: asString(metadata.summary, "metadata.summary"),
      significant_items: significantItems,
      worth_watching_items: worthWatchingItems,
      day_intensity: metadata.day_intensity,
      companies: asStringArray(metadata.companies, "metadata.companies"),
      topics: asStringArray(metadata.topics, "metadata.topics"),
      developments: asStringArray(
        metadata.developments,
        "metadata.developments",
      ),
    };
    return {
      markdown: asString(record.markdown, "markdown"),
      metadata: parsedMetadata,
    };
  });
}

function stageResult<T>(value: T, completion: AiCompletion): StageResult<T> {
  return { value, usage: completionUsage(completion) };
}

function completionUsage(completion: AiCompletion): ModelUsage {
  return {
    inputTokens: completion.usage.inputTokens,
    outputTokens: completion.usage.outputTokens,
    totalTokens: completion.usage.totalTokens,
  };
}

function serializeWindow(context: PipelineContext): Record<string, string> {
  return {
    date: context.window.date,
    timeZone: context.window.timeZone,
    start: context.window.start.toISOString(),
    endExclusive: context.window.endExclusive.toISOString(),
  };
}

function isInsideWindow(timestamp: string, context: PipelineContext): boolean {
  const time = Date.parse(timestamp);
  return (
    time >= context.window.start.getTime() &&
    time < context.window.endExclusive.getTime()
  );
}

function deduplicateById(
  candidates: readonly ResearchCandidate[],
): readonly ResearchCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(({ id }) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function validateQueries(queries: readonly string[]): readonly string[] {
  if (queries.length === 0) {
    throw new TypeError("At least one search query is required.");
  }
  queries.forEach((query) => asString(query, "query"));
  return [...queries];
}

function validateResultsPerQuery(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new RangeError("resultsPerQuery must be an integer between 1 and 50.");
  }
  return value;
}

function validateSearchHit(hit: SearchHit): void {
  asHttpUrl(hit.url, "searchHit.url");
  asString(hit.title, "searchHit.title");
  asString(hit.snippet, "searchHit.snippet");
  asString(hit.publisher, "searchHit.publisher");
  if (
    hit.publishedAt !== null &&
    !isUtcTimestamp(hit.publishedAt)
  ) {
    throw new TypeError("searchHit.publishedAt must be an ISO UTC timestamp or null.");
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function asStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

function asNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function asHttpUrl(value: unknown, path: string): string {
  const url = asString(value, path);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${path} must use HTTP or HTTPS.`);
  }
  return url;
}
